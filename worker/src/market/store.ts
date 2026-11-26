// NAV store writes (plan §10.4.2–§10.4.3): D1 `pocketfolio-market` and the R2 `market/nav/` series. Public market
// data only.
//
// Rows travel as one JSON array per statement, read back with json_each(?1). That keeps each statement to one or two
// bound parameters (D1 allows 100), so ~2,000 NAV rows fit in one statement instead of 30, and a whole night's file
// (~14.5k rows) is a single D1 batch (one transaction, one of the 1,000 queries per invocation).
import { addDays, ANOMALY_MOVE, type Anomaly, type NavRow, type SchemeRow, type Ymd, ymdToIso } from './amfi'

/** The Nifty 50 index fund used as the benchmark (§10.4.2): always tracked, always backfilled. */
export const BENCHMARK_CODE = 120716
export const NAV_ROWS_PER_STATEMENT = 2_000
export const SCHEME_ROWS_PER_STATEMENT = 400
/** market_day keeps dates this recent (nav-repair looks back 30 business days). Older dates come from wound-up schemes. */
export const RECENT_DAYS = 45
/** A tracked scheme counts toward a date's total only if its latest NAV is at most this much older than the date. */
export const LIVE_DAYS = 14
/** tracked_scheme rows unseen for longer than this no longer drive jobs (cleanup deletes them, M14). */
export const TRACKED_UNSEEN_MS = 90 * 86_400_000
export const FINAL_RATIO = 0.98

const chunks = <T>(rows: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

const NAV_JSON = `SELECT json_extract(value, '$[0]') AS amfi_code, json_extract(value, '$[1]') AS date,
  json_extract(value, '$[2]') AS nav FROM json_each(?1)`
const navJson = (rows: NavRow[]) => JSON.stringify(rows.map((r) => [r.amfi_code, r.date, r.nav]))

/** The codes the jobs keep full history and R2 series for: held by someone in the last 90 days, plus the benchmark. */
const TRACKED_CODES = `SELECT amfi_code AS code FROM tracked_scheme WHERE amfi_code IS NOT NULL AND last_seen_at >= ?{since} UNION SELECT ?{bench}`
const tracked = (since: number, bench: number) => TRACKED_CODES.replace('{since}', String(since)).replace('{bench}', String(bench))

// ─── Statements ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Insert NAV rows that aren't there yet. RETURNING gives exactly the rows inserted (a conflict returns nothing). */
export function insertNavStatements(db: D1Database, rows: NavRow[]): D1PreparedStatement[] {
  return chunks(rows, NAV_ROWS_PER_STATEMENT).map((c) =>
    db.prepare(`INSERT INTO nav (amfi_code, date, nav) ${NAV_JSON} WHERE true ON CONFLICT DO NOTHING RETURNING amfi_code, date`).bind(navJson(c)),
  )
}

/**
 * Daily-file anomalies: a new NAV more than ±20% away from the scheme's previous one (`scheme.latest_*`). Runs before
 * the scheme upsert in the same batch, so it still sees yesterday's values. Re-runs find nothing (the date is no
 * longer newer).
 */
export function schemeAnomalyStatements(db: D1Database, rows: NavRow[]): D1PreparedStatement[] {
  return chunks(rows, NAV_ROWS_PER_STATEMENT).map((c) =>
    db
      .prepare(
        `INSERT INTO nav_anomaly (amfi_code, date, prev_date, prev_nav, nav)
         SELECT j.amfi_code, j.date, s.latest_date, s.latest_nav, j.nav FROM (${NAV_JSON}) j JOIN scheme s ON s.amfi_code = j.amfi_code
         WHERE j.date > s.latest_date AND s.latest_nav > 0 AND abs(j.nav / s.latest_nav - 1.0) > ?2
         ON CONFLICT DO NOTHING`,
      )
      .bind(navJson(c), ANOMALY_MOVE),
  )
}

/** Anomalies found in a full series (backfill). */
export function anomalyStatements(db: D1Database, rows: Anomaly[]): D1PreparedStatement[] {
  return chunks(rows, NAV_ROWS_PER_STATEMENT).map((c) =>
    db
      .prepare(
        `INSERT INTO nav_anomaly (amfi_code, date, prev_date, prev_nav, nav)
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'),
                json_extract(value, '$[4]') FROM json_each(?1) WHERE true
         ON CONFLICT DO NOTHING`,
      )
      .bind(JSON.stringify(c.map((a) => [a.amfi_code, a.date, a.prev_date, a.prev_nav, a.nav]))),
  )
}

/**
 * Upsert the daily file's schemes. Unchanged rows are skipped by the WHERE (each rewrite counts as rows written and
 * holds the DB, 4 runs a night). An older date never replaces a newer NAV.
 */
export function schemeUpsertStatements(db: D1Database, schemes: SchemeRow[], now: number): D1PreparedStatement[] {
  // A code can appear twice in the file: keep the row with the newest NAV.
  const byCode = new Map<number, SchemeRow>()
  for (const s of schemes) {
    const prev = byCode.get(s.amfi_code)
    if (!prev || (s.date ?? 0) >= (prev.date ?? 0)) byCode.set(s.amfi_code, s)
  }
  const newer = 'COALESCE(excluded.latest_date, 0) > COALESCE(scheme.latest_date, 0)'
  return chunks([...byCode.values()], SCHEME_ROWS_PER_STATEMENT).map((c) =>
    db
      .prepare(
        `INSERT INTO scheme (amfi_code, isin_growth, isin_reinvest, name, amc, category, plan, option, latest_nav, latest_date, updated_at)
         SELECT ${Array.from({ length: 10 }, (_, i) => `json_extract(value, '$[${i}]')`).join(', ')}, ?2 FROM json_each(?1) WHERE true
         ON CONFLICT (amfi_code) DO UPDATE SET
           isin_growth = excluded.isin_growth, isin_reinvest = excluded.isin_reinvest, name = excluded.name, amc = excluded.amc,
           category = excluded.category, plan = excluded.plan, option = excluded.option,
           latest_nav = CASE WHEN ${newer} THEN excluded.latest_nav ELSE scheme.latest_nav END,
           latest_date = CASE WHEN ${newer} THEN excluded.latest_date ELSE scheme.latest_date END,
           updated_at = excluded.updated_at
         WHERE ${newer}
            OR excluded.name IS NOT scheme.name OR excluded.isin_growth IS NOT scheme.isin_growth
            OR excluded.isin_reinvest IS NOT scheme.isin_reinvest OR excluded.amc IS NOT scheme.amc
            OR excluded.category IS NOT scheme.category OR excluded.plan IS NOT scheme.plan OR excluded.option IS NOT scheme.option`,
      )
      .bind(JSON.stringify(c.map((s) => [s.amfi_code, s.isin_growth, s.isin_reinvest, s.name, s.amc, s.category, s.plan, s.option, s.nav, s.date])), now),
  )
}

/**
 * Give tracked_scheme rows without a code (CDSL statements carry only the ISIN) the code from `scheme` (§10.4.2).
 * `isins` limits it to one statement's schemes; without it, every unresolved row is tried (nav-ingest).
 */
export function resolveTrackedStatement(db: D1Database, isins?: string[]): D1PreparedStatement {
  const only = isins ? 'AND isin IN (SELECT value FROM json_each(?1))' : ''
  const stmt = db.prepare(
    `UPDATE tracked_scheme SET amfi_code = (
       SELECT amfi_code FROM scheme WHERE isin_growth = tracked_scheme.isin
       UNION ALL SELECT amfi_code FROM scheme WHERE isin_reinvest = tracked_scheme.isin LIMIT 1)
     WHERE amfi_code IS NULL ${only}
       AND (EXISTS (SELECT 1 FROM scheme WHERE isin_growth = tracked_scheme.isin)
            OR EXISTS (SELECT 1 FROM scheme WHERE isin_reinvest = tracked_scheme.isin))`,
  )
  return isins ? stmt.bind(JSON.stringify(isins)) : stmt
}

/** Mark tracked codes with no nav_backfill row as pending. RETURNING gives the codes to enqueue (once each). */
export function pendingBackfillStatement(db: D1Database, now: number, isins?: string[]): D1PreparedStatement {
  if (isins) {
    return db
      .prepare(
        `INSERT INTO nav_backfill (amfi_code, status, at)
         SELECT DISTINCT amfi_code, 'pending', ?2 FROM tracked_scheme WHERE amfi_code IS NOT NULL AND isin IN (SELECT value FROM json_each(?1))
         ON CONFLICT DO NOTHING RETURNING amfi_code`,
      )
      .bind(JSON.stringify(isins), now)
  }
  return db
    .prepare(`INSERT INTO nav_backfill (amfi_code, status, at) SELECT code, 'pending', ?1 FROM (${tracked(2, 3)}) WHERE true ON CONFLICT DO NOTHING RETURNING amfi_code`)
    .bind(now, now - TRACKED_UNSEEN_MS, BENCHMARK_CODE)
}

// ─── market_day and finality ────────────────────────────────────────────────────────────────────────────────────

/**
 * Add a date's newly stored rows to schemes_updated, and recount its tracked coverage exactly. A tracked scheme whose
 * latest NAV is more than 14 days older than the date (wound up, merged) doesn't count toward the total.
 */
function marketDayStatement(db: D1Database, date: Ymd, inserted: number, now: number): D1PreparedStatement {
  return db
    .prepare(
      `WITH t AS (${tracked(3, 4)}),
            live AS (SELECT t.code FROM t JOIN scheme s ON s.amfi_code = t.code WHERE s.latest_date >= ?5)
       INSERT INTO market_day (date, schemes_updated, tracked_total, tracked_updated)
       SELECT ?1, ?2, (SELECT COUNT(*) FROM live), (SELECT COUNT(*) FROM live JOIN nav n ON n.amfi_code = live.code AND n.date = ?1) WHERE true
       ON CONFLICT (date) DO UPDATE SET schemes_updated = market_day.schemes_updated + excluded.schemes_updated,
         tracked_total = excluded.tracked_total, tracked_updated = excluded.tracked_updated
       WHERE excluded.schemes_updated > 0 OR excluded.tracked_total <> market_day.tracked_total
          OR excluded.tracked_updated <> market_day.tracked_updated`,
    )
    .bind(date, inserted, now - TRACKED_UNSEEN_MS, BENCHMARK_CODE, addDays(date, -LIVE_DAYS))
}

export type StoreResult = {
  /** NAV rows actually inserted (0 on a re-run). */
  inserted: number
  /** Dates that just became final, oldest first. Each date is returned once, ever. */
  finalized: Ymd[]
  /** Tracked codes that got new rows (their R2 series must be rewritten). */
  changedTracked: number[]
  /** Results of `before` and `after`, in order. */
  extra: D1Result[]
}

/**
 * Store NAV rows: one batch to insert them (with `before`/`after` statements in the same transaction), then one batch
 * for market_day, finality and the tracked set. `finalUpTo` (the last nav-ingest run of the night) makes every
 * non-final date up to it final whatever its coverage.
 */
export async function storeNavs(
  env: { MARKET: D1Database },
  rows: NavRow[],
  opts: { now: number; today: Ymd; before?: D1PreparedStatement[]; after?: D1PreparedStatement[]; finalUpTo?: Ymd | null },
): Promise<StoreResult> {
  const db = env.MARKET
  const before = opts.before ?? []
  const after = opts.after ?? []
  const inserts = insertNavStatements(db, rows)
  const res = await db.batch<{ amfi_code: number; date: Ymd }>([...before, ...inserts, ...after])
  const insertedRows = res.slice(before.length, before.length + inserts.length).flatMap((r) => r.results ?? [])
  const extra = [...res.slice(0, before.length), ...res.slice(before.length + inserts.length)]

  const byDate = new Map<Ymd, number>()
  const recent = addDays(opts.today, -RECENT_DAYS)
  for (const r of insertedRows) if (r.date >= recent) byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1)
  const dates = [...byDate.keys()].sort((a, b) => a - b)

  const stmts: D1PreparedStatement[] = dates.map((d) => marketDayStatement(db, d, byDate.get(d)!, opts.now))
  stmts.push(
    db
      .prepare(
        `UPDATE market_day SET final = 1 WHERE final = 0 AND date IN (SELECT value FROM json_each(?1))
           AND tracked_total > 0 AND tracked_updated >= tracked_total * ?2 RETURNING date`,
      )
      .bind(JSON.stringify(dates), FINAL_RATIO),
    opts.finalUpTo ? db.prepare('UPDATE market_day SET final = 1 WHERE final = 0 AND date <= ?1 RETURNING date').bind(opts.finalUpTo) : db.prepare('SELECT NULL AS date WHERE 0'),
    db.prepare(`SELECT code FROM (${tracked(1, 2)})`).bind(opts.now - TRACKED_UNSEEN_MS, BENCHMARK_CODE),
  )
  const out = await db.batch<{ date?: Ymd; code?: number }>(stmts)
  const [byRatio, byCron, trackedRes] = out.slice(-3)
  const finalized = [...new Set([...(byRatio?.results ?? []), ...(byCron?.results ?? [])].map((r) => r.date!))].sort((a, b) => a - b)
  const trackedSet = new Set((trackedRes?.results ?? []).map((r) => r.code!))
  const changedTracked = [...new Set(insertedRows.map((r) => r.amfi_code))].filter((c) => trackedSet.has(c)).sort((a, b) => a - b)
  return { inserted: insertedRows.length, finalized, changedTracked, extra }
}

// ─── R2 series (§10.2: the engine reads these in M10) ───────────────────────────────────────────────────────────

export const seriesKey = (code: number) => `market/nav/${code}.json`

export type NavSeries = { amfi_code: number; dates: string[]; navs: number[] }

/**
 * Rewrite the full series of each code from D1 to R2 as `{ amfi_code, dates: ISO[], navs }`, oldest first. Reads go to
 * the primary (`first-primary`): the rows were usually written moments ago.
 */
export async function writeSeries(env: { MARKET: D1Database; BUCKET: R2Bucket }, codes: number[]): Promise<number> {
  if (!codes.length) return 0
  const db = env.MARKET.withSession('first-primary')
  const res = await db.batch<{ date: Ymd; nav: number }>(codes.map((c) => db.prepare('SELECT date, nav FROM nav WHERE amfi_code = ?1 ORDER BY date').bind(c)))
  let written = 0
  for (const [i, code] of codes.entries()) {
    const rows = res[i]?.results ?? []
    if (!rows.length) continue
    const series: NavSeries = { amfi_code: code, dates: rows.map((r) => ymdToIso(r.date)), navs: rows.map((r) => r.nav) }
    await env.BUCKET.put(seriesKey(code), JSON.stringify(series), { httpMetadata: { contentType: 'application/json' } })
    written++
  }
  return written
}
