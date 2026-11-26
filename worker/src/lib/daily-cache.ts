// GET /api/portfolio/daily (plan §10.5.3, M12): the household's daily series, cache first.
//
// 0. The cache: h/{household}/daily/{inputs_hash}_{latest_nav_date}_{member|all}.bin holds the full 366-day series
//    for that member key, sealed and gzip-compressed (D18); `days` is sliced from it. New statements change
//    inputs_hash and new NAVs change latest_nav_date, so an old entry is never read; the rebuild deletes them. While
//    coverage is partial (some funds haven't published yet), an entry is fresh for 30 minutes only.
// 1. Otherwise: open the snapshot (units timelines, AMFI codes), read the window's NAVs and flagged NAV moves in one
//    batch on a MARKET read replica (D17), run dailySeries(), and store the result.
import type { MarketStatus } from '../routes/market'
import { blobKeys, deletePrefix, getJsonBlob, ownsKey, putJsonBlob } from './blob'
import { addDaysIso, type DailyHolding, type DailyResult, dailySeries, LEAD_DAYS, type NavSeries, sliceDays } from './daily'
import type { Vault } from './crypto'

/** The cache always holds this many days; requests slice from it. */
export const DAILY_FULL_DAYS = 366
/** A partial-coverage entry is recomputed after this long, so late NAVs show up. */
export const DAILY_PARTIAL_FRESH_MS = 30 * 60_000
const CACHE_FORMAT = 1

type CacheBlob = { format: number; computed_at: number; partial: boolean; result: DailyResult }
type Snapshot = { holdings?: DailyHolding[] }

export const EMPTY_DAILY: DailyResult = {
  as_of: null,
  coverage: { updated: 0, total: 0 },
  today: null,
  series: [],
  notes: { units_as_of: null, units_exact: false, estimated: { instalments: 0, amount: 0 }, excluded: 0 },
}

const isoToYmd = (iso: string) => Number(iso.replaceAll('-', ''))
const ymdToIsoStr = (ymd: number) => `${String(ymd).slice(0, 4)}-${String(ymd).slice(4, 6)}-${String(ymd).slice(6, 8)}`

export type DailyRequest = {
  householdId: string
  vault: Vault
  snapshotKey: string
  inputsHash: string
  market: MarketStatus
  /** `all` or a member id already checked against the household (on a cache miss). */
  member: string
  days: number
  now?: number
  /** Check the member on a miss only: a hit's key could only have been written after that check. */
  checkMember?: () => Promise<unknown>
  waitUntil?: (p: Promise<unknown>) => void
}

export type DailyAnswer = { result: DailyResult; cache: 'hit' | 'miss' }

export async function dailyFor(env: Env, req: DailyRequest): Promise<DailyAnswer> {
  const now = req.now ?? Date.now()
  const key = blobKeys.daily(req.householdId, req.inputsHash, req.market.latest_nav_date ?? 'none', req.member)
  const cached = await getJsonBlob<CacheBlob>(env, req.vault, key).catch(() => null)
  if (cached?.format === CACHE_FORMAT && (!cached.partial || now - cached.computed_at < DAILY_PARTIAL_FRESH_MS)) {
    return { result: sliceDays(cached.result, req.days), cache: 'hit' }
  }
  if (req.member !== 'all') await req.checkMember?.()

  if (!ownsKey(req.householdId, req.snapshotKey)) throw new Error('snapshot key outside the household')
  const snap = await getJsonBlob<Snapshot>(env, req.vault, req.snapshotKey)
  const holdings = (snap?.holdings ?? []).filter((h) => req.member === 'all' || h.member_id === req.member)
  const codes = [...new Set(holdings.map((h) => h.amfi_code).filter((c): c is string => !!c && /^\d{1,9}$/.test(c)))]
  const latest = req.market.latest_nav_date
  const from = addDaysIso(latest ?? new Date(now).toISOString().slice(0, 10), -(DAILY_FULL_DAYS + LEAD_DAYS + 1))
  const { navs, anomalies } = codes.length ? await readNavs(env, codes, isoToYmd(from)) : { navs: new Map(), anomalies: new Set<string>() }

  const result = dailySeries({ holdings, navs, anomalies, latest, days: DAILY_FULL_DAYS })
  const blob: CacheBlob = { format: CACHE_FORMAT, computed_at: now, partial: result.coverage.updated < result.coverage.total, result }
  const put = putJsonBlob(env, req.vault, key, blob).catch((e) => console.error('daily_cache_put_failed', (e as Error).name))
  if (req.waitUntil) req.waitUntil(put)
  else await put
  return { result: sliceDays(result, req.days), cache: 'miss' }
}

/**
 * One batch on a replica: the window's NAV rows for the codes (one JSON array parameter, so no bound-parameter cap)
 * and the flagged NAV moves. ~50 funds × 280 days ≈ 14k rows.
 */
async function readNavs(env: Env, codes: string[], fromYmd: number) {
  const read = env.MARKET.withSession('first-unconstrained')
  const list = JSON.stringify(codes.map(Number))
  const [navRes, anomalyRes] = await read.batch([
    read.prepare('SELECT amfi_code, date, nav FROM nav WHERE amfi_code IN (SELECT value FROM json_each(?1)) AND date >= ?2 ORDER BY amfi_code, date').bind(list, fromYmd),
    read.prepare('SELECT amfi_code, date FROM nav_anomaly WHERE amfi_code IN (SELECT value FROM json_each(?1)) AND date >= ?2').bind(list, fromYmd),
  ])
  const navs = new Map<string, NavSeries>()
  for (const r of navRes!.results as { amfi_code: number; date: number; nav: number }[]) {
    const code = String(r.amfi_code)
    let s = navs.get(code)
    if (!s) navs.set(code, (s = { dates: [], navs: [] }))
    s.dates.push(ymdToIsoStr(r.date))
    s.navs.push(r.nav)
  }
  const anomalies = new Set((anomalyRes!.results as { amfi_code: number; date: number }[]).map((a) => `${a.amfi_code}|${ymdToIsoStr(a.date)}`))
  return { navs, anomalies }
}

/** Drop a snapshot's cached daily series (all of the household's with no hash). Never throws. */
export async function deleteDailyCache(env: { BUCKET: R2Bucket }, householdId: string, inputsHash?: string | null): Promise<number> {
  if (inputsHash === null) return 0
  try {
    return await deletePrefix(env, blobKeys.dailyPrefix(householdId, inputsHash))
  } catch (e) {
    console.error('daily_cache_delete_failed', (e as Error).name)
    return 0
  }
}
