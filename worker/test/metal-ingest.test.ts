// Gold and silver rate ingest (plan §21.5, M29): saved public NAVs of the reference ETFs (mfapi: October–November
// 2026 and the silver anchor days) go into the NAV store, the job derives the rates with the real anchors, a re-run
// writes 0 rows, the reference ETFs' history is asked for once, and the served series is month-ends plus the last 31
// days. Public data only.
import { createMessageBatch, env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMfapi } from '../src/market/amfi'
import { handleMarketBatch, marketQueue, type MarketMessage, refreshMetals } from '../src/market/jobs'
import { METAL_REFS, metalRates, readMetalRates, REF_CODES } from '../src/market/metals'
import fixture from './fixtures/amfi/mfapi-metal-etfs-excerpt.json?raw'

vi.setConfig({ testTimeout: 30_000 })

// IBJA's published PM closes on 26 Nov 2026 (₹/10 g and ₹/kg), for comparison only.
const IBJA_GOLD_26NOV = 122_641 / 10
const IBJA_SILVER_26NOV = 147_347 / 1000

async function storeFixture() {
  const files = JSON.parse(fixture) as Record<string, unknown>
  const rows = Object.entries(files).flatMap(([code, body]) => parseMfapi(body, Number(code), 20261126))
  expect(rows.length).toBe(426)
  await env.MARKET.prepare(
    `INSERT INTO nav (amfi_code, date, nav) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]')
     FROM json_each(?1) WHERE true ON CONFLICT DO NOTHING`,
  ).bind(JSON.stringify(rows.map((r) => [r.amfi_code, r.date, r.nav]))).run()
}

beforeEach(async () => {
  await env.MARKET.batch(['nav', 'nav_backfill', 'metal_rate'].map((t) => env.MARKET.prepare(`DELETE FROM ${t}`)))
})
afterEach(() => vi.restoreAllMocks())

describe('metal-rates', () => {
  it('derives daily rates close to IBJA from the saved NAVs; a re-run writes 0 rows', async () => {
    await storeFixture()
    const r1 = await metalRates(env, Date.UTC(2026, 10, 26, 20))
    expect(r1).toMatchObject({ ok: true, error_class: null })
    expect(r1.changed).toBe(r1.rates)
    expect(r1.backfills.sort((a, b) => a - b)).toEqual([...REF_CODES].sort((a, b) => a - b)) // history asked for once
    const day = (metal: string) => env.MARKET.prepare('SELECT rate, etfs FROM metal_rate WHERE metal = ?1 AND date = 20261126').bind(metal).first<{ rate: number; etfs: number }>()
    const gold = await day('gold')
    const silver = await day('silver')
    expect(gold?.etfs).toBe(METAL_REFS.filter((r) => r.metal === 'gold').length)
    expect(silver?.etfs).toBe(METAL_REFS.filter((r) => r.metal === 'silver').length)
    expect(Math.abs(gold!.rate / IBJA_GOLD_26NOV - 1)).toBeLessThan(0.01)
    expect(Math.abs(silver!.rate / IBJA_SILVER_26NOV - 1)).toBeLessThan(0.015)

    const r2 = await metalRates(env, Date.UTC(2026, 10, 26, 23))
    expect(r2).toMatchObject({ ok: true, rates: r1.rates, changed: 0, backfills: [] })
  })

  it('serves month-end points plus the last 31 days, as ISO dates', async () => {
    await env.MARKET.prepare(
      `INSERT INTO metal_rate (metal, date, rate, etfs) VALUES
         ('gold', 20260929, 11000, 5), ('gold', 20260930, 11100, 5), ('gold', 20261015, 11500, 5), ('gold', 20261030, 11600, 5),
         ('gold', 20261102, 11700, 5), ('gold', 20261126, 12300, 5), ('silver', 20261126, 147.3, 5)`,
    ).run()
    // 31 days before 26 Nov is 26 Oct: September and early October collapse to their last day
    expect(await readMetalRates(env, 20261126)).toEqual({
      gold: [['2026-09-30', 11100], ['2026-10-15', 11500], ['2026-10-30', 11600], ['2026-11-02', 11700], ['2026-11-26', 12300]],
      silver: [['2026-11-26', 147.3]],
    })
  })

  it('a reference ETF backfill runs the rates again; the first run queues the backfills', async () => {
    const sent: MarketMessage[] = []
    vi.spyOn(marketQueue, 'sendBatch').mockImplementation(async (_env, msgs) => { sent.push(...msgs) })
    await refreshMetals(env, Date.now())
    expect(sent.map((m) => (m as { code: number }).code).sort((a, b) => a - b)).toEqual([...REF_CODES].sort((a, b) => a - b))

    // the backfill itself: mfapi serves the saved excerpt; then the rates are derived from it
    const files = JSON.parse(fixture) as Record<string, unknown>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(files['140088']))
    const batch = createMessageBatch<MarketMessage>('pf-market', [{ id: 'm1', timestamp: new Date(), attempts: 1, body: { type: 'backfill', code: 140088 } }])
    await handleMarketBatch(batch, env)
    expect(await env.MARKET.prepare("SELECT COUNT(*) AS n FROM metal_rate WHERE metal = 'gold'").first('n')).toBeGreaterThan(30)
  })
})
