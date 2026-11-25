// Fair-use counters (plan §11). One prepared statement per counter; several counters are taken all-or-nothing in
// one D1 batch (= one transaction, one round trip). The trick: when a counter is at its limit the UPSERT writes NULL
// into quota.count, which is NOT NULL, so the statement fails and D1 rolls the whole batch back. No read-then-write,
// so it holds under concurrency.
//
// Windows are Indian Standard Time (UTC+05:30), the users' "day" and "month".

export type QuotaPeriod = 'hour' | 'day' | 'month'
export type QuotaSpec = { subject: string; metric: string; period: QuotaPeriod; limit: number }
export type QuotaResult =
  | { ok: true }
  | { ok: false; subject: string; metric: string; period: QuotaPeriod; limit: number; retryAfter: number }

const IST_MS = 330 * 60_000

/** The window label for a period at `now`: '2026-11-24T13' (hour), '2026-11-24' (day), '2026-11' (month). */
export function quotaWindow(period: QuotaPeriod, now = Date.now()): string {
  const iso = new Date(now + IST_MS).toISOString()
  return period === 'hour' ? iso.slice(0, 13) : period === 'day' ? iso.slice(0, 10) : iso.slice(0, 7)
}

/** Seconds from `now` until the window ends (≥ 1). */
export function secondsLeft(period: QuotaPeriod, now = Date.now()): number {
  const t = new Date(now + IST_MS)
  const [y, mo, d, h] = [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours()]
  const endIst = period === 'hour' ? Date.UTC(y, mo, d, h + 1) : period === 'day' ? Date.UTC(y, mo, d + 1) : Date.UTC(y, mo + 1, 1)
  return Math.max(1, Math.ceil((endIst - IST_MS - now) / 1000))
}

/** The UPSERT for one counter. Exposed so a caller can put it in its own batch (it then aborts that batch too). */
export function quotaStatement(db: D1Database, spec: QuotaSpec, now = Date.now()): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO quota (subject, metric, window, count) VALUES (?1, ?2, ?3, CASE WHEN ?4 >= 1 THEN 1 END)
       ON CONFLICT (subject, metric, window) DO UPDATE SET count = CASE WHEN count < ?4 THEN count + 1 END`,
    )
    .bind(spec.subject, spec.metric, quotaWindow(spec.period, now), spec.limit)
}

/** True when a D1 error is a quota counter refusing (the NOT NULL abort above). */
export function isQuotaRefusal(err: unknown): boolean {
  return err instanceof Error && /NOT NULL constraint failed: quota\.count/.test(err.message)
}

/**
 * Take one unit from every counter, or from none. On refusal, says which counter was full (one extra read, only on
 * the refusal path) and how long until its window resets.
 */
export async function takeQuota(env: { DB: D1Database }, specs: QuotaSpec[], now = Date.now()): Promise<QuotaResult> {
  if (!specs.length) return { ok: true }
  try {
    await env.DB.batch(specs.map((s) => quotaStatement(env.DB, s, now)))
    return { ok: true }
  } catch (err) {
    if (!isQuotaRefusal(err)) throw err
  }
  const counts = await quotaCounts(env, specs, now)
  const full = specs.find((s, i) => counts[i]! >= s.limit) ?? specs[0]!
  return { ok: false, ...full, retryAfter: secondsLeft(full.period, now) }
}

/** Current counts for each spec's window (0 when unused). For Settings → fair-use usage. */
export async function quotaCounts(env: { DB: D1Database }, specs: QuotaSpec[], now = Date.now()): Promise<number[]> {
  if (!specs.length) return []
  const rows = await env.DB.batch<{ count: number }>(
    specs.map((s) =>
      env.DB.prepare('SELECT count FROM quota WHERE subject = ?1 AND metric = ?2 AND window = ?3').bind(s.subject, s.metric, quotaWindow(s.period, now)),
    ),
  )
  return rows.map((r) => r.results[0]?.count ?? 0)
}
