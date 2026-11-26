// M11 live check (opt-in, spends ~3–5 of the day's BharatStock calls):
//   BHARATSTOCK_LIVE=1 npx vitest run test/stocks.live.test.ts
// A synthetic household whose one equity fund is a real public fund: built on the real EngineBatch container, which
// names the fund it needs (X-Engine-Stocks-Want); the job matches and fetches it from the real BharatStock API with
// the key from .dev.vars; the follow-up build's snapshot has its stocks. Prints counts only.
import { env } from 'cloudflare:test'
import { describe, expect, inject, it, vi } from 'vitest'
import { blobKeys, putJsonBlob } from '../src/lib/blob'
import { requestRebuild, runRebuild } from '../src/lib/snapshot'
import { runStocks } from '../src/market/stocks'
import { call } from './helpers/auth'
import { takeRebuilds } from './helpers/snapshot'
import { addMember, newHousehold } from './helpers/tenant'

const live = inject('stocksLive')

describe.skipIf(!live)('stocks, live (BharatStock + real engine)', () => {
  it('an equity fund in a test household gets its holdings', { timeout: 600_000 }, async () => {
    const { key, statement } = JSON.parse(live!) as { key: string; statement: Record<string, unknown> & { pan: string; period_to: string } }
    const liveEnv = { ...env, BHARATSTOCK_API_KEY: key } as Env
    const realFetch = (globalThis as { pfRealFetch?: typeof fetch }).pfRealFetch!
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => realFetch(input, init))

    const h = await newHousehold('stocks-live')
    const member = await addMember(h, statement.pan, null)
    const id = crypto.randomUUID()
    const blobKey = blobKeys.statement(h.householdId, id)
    await putJsonBlob(env, await h.tenant.vault(), blobKey, { format: 1, kind: 'KFINTECH', parser_version: 'test', statement })
    await env.DB.prepare(
      `INSERT INTO statement (id, household_id, member_id, kind, as_of, blob_key, content_hash, parser_version, holdings_count, warnings_count, created_at)
       VALUES (?1, ?2, ?3, 'KFINTECH', ?4, ?5, ?6, 'test', 2, 0, ?7)`,
    ).bind(id, h.householdId, member, statement.period_to, blobKey, crypto.randomUUID(), Date.now()).run()

    await requestRebuild(liveEnv, h.householdId)
    const [msg] = takeRebuilds(h.householdId)
    const first = await runRebuild(liveEnv, msg!.msg)
    expect(first.outcome).toBe('built')
    expect(first.requeue?.msg.force, 'a follow-up build for the stocks').toBe(true)
    const wanted = await env.MARKET.prepare('SELECT COUNT(*) AS n FROM stock_match').first<number>('n')
    expect(wanted, 'the engine named the equity fund (not the liquid one)').toBe(1)

    const run = await runStocks(liveEnv)
    expect(run).toMatchObject({ status: 'done', matched: 1, fetched: 1, failed: 0 })
    let calls = run.status === 'done' ? run.calls : 0
    let next = await runRebuild(liveEnv, first.requeue!.msg)
    expect(next.outcome).toBe('built')
    // A fund that holds units of other funds: the build names those too, and one more round fetches them.
    let rounds = 1
    while (next.requeue && rounds < 3) {
      const more = await runStocks(liveEnv)
      calls += more.status === 'done' ? more.calls : 0
      next = await runRebuild(liveEnv, next.requeue.msg)
      rounds++
    }

    const res = await call('/api/portfolio', { jar: h.jar })
    const snap = await res.json<{ stocks: { enabled: boolean; funds: Record<string, [string, number][]>; stocks: Record<string, unknown>; month: string | null; pending: number; refreshing: boolean } }>()
    const funds = Object.values(snap.stocks.funds)
    expect(snap.stocks.enabled).toBe(true)
    expect(funds).toHaveLength(1)
    expect(funds[0]!.length).toBeGreaterThan(10)
    expect([snap.stocks.pending, snap.stocks.refreshing]).toEqual([0, false])
    const pct = funds[0]!.reduce((s, [, w]) => s + w, 0)
    const lookedThrough = Object.keys((snap.stocks as { look_through?: object }).look_through ?? {}).length
    console.log(`stocks live ok: ${calls} paid calls, ${rounds} job rounds, ${funds.length} fund, ${funds[0]!.length} holdings (${Math.round(pct)}% of the fund), look-through ${lookedThrough}, month ${snap.stocks.month}`)
  })
})
