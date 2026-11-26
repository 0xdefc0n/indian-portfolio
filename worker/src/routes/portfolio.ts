// GET /api/portfolio and /api/portfolio/status (plan §9.2, §10.2, M10).
//
// The snapshot is sent without parsing it: the sealed blob is opened and its gzip bytes go out as they are, with
// Content-Encoding: gzip (encodeBody "manual"), so Worker CPU and memory stay flat whatever the portfolio size. The
// stale/building flags travel in headers (X-Snapshot-Stale, X-Snapshot-Building) and the SPA merges them in.
import { Hono } from 'hono'
import { blobKeys, ownsKey } from '../lib/blob'
import { FLAG_GZIP } from '../lib/crypto'
import { lazyRebuild, readSnapshotRow, snapshotState } from '../lib/snapshot'
import { tenant } from '../lib/tenant'
import { requireSession } from '../middleware/session'
import type { AppBindings } from '../types'
import { cachedMarketStatus } from './market'

export const portfolioRoutes = new Hono<AppBindings>()
const signedIn = requireSession()

/** Polling hint while a build is due (§11: clients follow Retry-After). */
export const STATUS_RETRY_S = 3

const EMPTY_STOCKS = {
  enabled: false, funds: {}, stocks: {}, month: null, oldest_month: null, unmatched: [], no_stocks: [], look_through: {},
  pending: 0, refreshing: false,
}
export const EMPTY_PORTFOLIO = { members: [], holdings: [], activity: [], sips: [], benchmark: null, stocks: EMPTY_STOCKS }

portfolioRoutes.get('/portfolio', signedIn, async (c) => {
  const hid = c.var.householdId
  const [row, market] = await Promise.all([readSnapshotRow(c.env, hid), cachedMarketStatus(c.env, (p) => c.executionCtx.waitUntil(p))])
  if (!row) return c.json(EMPTY_PORTFOLIO, 200, flags(false, false))
  const state = snapshotState(row, market)
  const asked = await lazyRebuild(c.env, hid, row, state).catch((e) => {
    console.error('rebuild_request_failed', (e as Error).name)
    return false
  })
  const building = state.building || state.pending || asked

  const obj = row.blob_key && ownsKey(hid, row.blob_key) && row.blob_key.startsWith(`${blobKeys.householdPrefix(hid)}snapshot/`) ? await c.env.BUCKET.get(row.blob_key) : null
  if (!obj) return c.json(EMPTY_PORTFOLIO, 200, flags(false, building && state.statements > 0))

  const vault = await tenant(c).vaultFromRow(row)
  const { bytes, flags: blobFlags } = await vault.open(row.blob_key!, await obj.arrayBuffer())
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', ...flags(state.stale, building) })
  if (!(blobFlags & FLAG_GZIP)) return new Response(bytes, { headers })
  if (/\bgzip\b/i.test(c.req.header('accept-encoding') ?? '')) {
    // ✅ M10: workerd passes a pre-compressed body through untouched with encodeBody "manual" (verified with
    // wrangler dev + curl; staging re-check in the M10 notes).
    headers.set('content-encoding', 'gzip')
    headers.set('content-length', String(bytes.length))
    return new Response(bytes, { headers, encodeBody: 'manual' })
  }
  // A client that can't take gzip: decompress as a stream (still never parsed).
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), { headers })
})

portfolioRoutes.get('/portfolio/status', signedIn, async (c) => {
  const [row, market] = await Promise.all([readSnapshotRow(c.env, c.var.householdId), cachedMarketStatus(c.env, (p) => c.executionCtx.waitUntil(p))])
  if (!row) return c.json({ status: 'empty', building: false, pending: false, stale: false, market_date: null, built_at: null })
  const s = snapshotState(row, market)
  const status = !s.statements ? 'empty' : s.building ? 'building' : s.pending ? 'pending' : s.failed ? 'failed' : 'ready'
  if (s.building || s.pending) c.header('Retry-After', String(STATUS_RETRY_S))
  c.header('Cache-Control', 'private, no-store')
  return c.json({ status, building: s.building, pending: s.pending, stale: s.stale, market_date: s.market_date, built_at: s.built_at })
})

function flags(stale: boolean, building: boolean): Record<string, string> {
  return { 'X-Snapshot-Stale': stale ? '1' : '0', 'X-Snapshot-Building': building ? '1' : '0', 'Cache-Control': 'private, no-store' }
}
