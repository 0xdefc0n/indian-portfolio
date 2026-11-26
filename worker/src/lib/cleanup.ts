// The nightly `cleanup` cron (plan §10.3, `0 21 * * *` = 02:30 IST, M14). Each step is small, bounded and
// independent: one failing step is logged (class name only) and the rest still run. Logs carry counts only.
//
// DPDP inactivity (plan §12, Rule 8): after INACTIVE_MS with no sign-in or use, email a notice; at least
// NOTICE_MS later, if the user still hasn't come back, erase the account (lib/account.ts). Signing in, or using the
// app (the session refresh stamps last_active_at), clears the notice.
import { deleteAccount } from './account'
import { AUDIT_RETENTION_MS } from './audit'
import type { InactivityEmailJob } from './email'
import { quotaWindow } from './quota'
import { holdingsKey } from '../market/stocks'
import { TRACKED_UNSEEN_MS } from '../market/store'

export const CLEANUP_CRON = '0 21 * * *'

const DAY = 86_400_000
/** No sign-in or use for this long → the notice (owner, 2026-11-26: 3 years, the Third Schedule's period). */
export const INACTIVE_MS = 3 * 365 * DAY
/** Rule 8(2): the notice comes at least 48 hours before erasure. */
export const NOTICE_MS = 48 * 3_600_000
/** Finished upload jobs (no PDF, no password) are kept a week for the Processing list's history. */
export const FINISHED_JOB_MS = 7 * DAY
/** Quota windows older than this can't be the current hour, day or month of any counter. */
export const QUOTA_KEEP_MS = 35 * DAY
export const NAV_RUN_KEEP_MS = 90 * DAY
/** stock_match rows no build asked for in this long, with their holdings (public data), are dropped. */
export const STOCK_UNWANTED_MS = 90 * DAY

const NOTICES_PER_RUN = 500
const ERASURES_PER_RUN = 50
const STOCKS_PER_RUN = 200

type CleanupEnv = Pick<Env, 'DB' | 'MARKET' | 'BUCKET' | 'Q_EMAIL' | 'APP_URL' | 'BETTER_AUTH_SECRET' | 'DATA_KEK_V1'>

export type CleanupResult = Record<string, number>

export async function cleanup(env: CleanupEnv, opts: { now?: number } = {}): Promise<CleanupResult> {
  const now = opts.now ?? Date.now()
  const out: CleanupResult = {}
  const step = async (name: string, fn: () => Promise<number>) => {
    try {
      out[name] = await fn()
    } catch (err) {
      out[name] = -1
      console.error('cleanup_step_failed', name, (err as Error).name)
    }
  }
  await step('inactivity_notices', () => sendInactivityNotices(env, now))
  await step('inactivity_erasures', () => eraseInactive(env, now))
  await step('app_rows', () => appRows(env, now))
  await step('market_rows', () => marketRows(env, now))
  await step('stock_rows', () => stockRows(env, now))
  console.log('cleanup_done', JSON.stringify(out))
  return out
}

const changes = (r: D1Result[]) => r.reduce((n, x) => n + (x.meta.changes ?? 0), 0)

/** IST date, YYYY-MM-DD. */
const istDay = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10)

async function sendInactivityNotices(env: CleanupEnv, now: number): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT h.id, u.email FROM household h JOIN user u ON u.id = h.owner_user_id
     WHERE h.last_active_at < ?1 AND h.inactivity_notice_at IS NULL LIMIT ?2`,
  )
    .bind(now - INACTIVE_MS, NOTICES_PER_RUN)
    .all<{ id: string; email: string }>()
  const list = rows.results
  if (!list.length) return 0
  // The erasure is the first nightly run at least NOTICE_MS after this one (02:30 IST that day): the email says to
  // sign in before that date.
  const eraseOn = istDay(now + NOTICE_MS)
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100)
    await env.Q_EMAIL.sendBatch(chunk.map((r) => ({ body: { kind: 'inactivity_notice', to: r.email, erase_on: eraseOn, created_at: now } satisfies InactivityEmailJob })))
    await env.DB.batch(
      chunk.flatMap((r) => [
        env.DB.prepare('UPDATE household SET inactivity_notice_at = ?1 WHERE id = ?2 AND inactivity_notice_at IS NULL').bind(now, r.id),
        env.DB.prepare(`INSERT INTO audit_event (user_id, household_id, event, ip_country, ua_hash, at) SELECT owner_user_id, id, 'inactivity_notice', NULL, NULL, ?1 FROM household WHERE id = ?2`).bind(now, r.id),
      ]),
    )
  }
  return list.length
}

async function eraseInactive(env: CleanupEnv, now: number): Promise<number> {
  // still inactive: no sign-in or use since before the notice (either one clears inactivity_notice_at anyway)
  const rows = await env.DB.prepare(
    `SELECT h.id AS household_id, u.id AS user_id, u.email FROM household h JOIN user u ON u.id = h.owner_user_id
     WHERE h.inactivity_notice_at IS NOT NULL AND h.inactivity_notice_at <= ?1 AND h.last_active_at < h.inactivity_notice_at
       AND h.last_active_at < ?2
     LIMIT ?3`,
  )
    .bind(now - NOTICE_MS, now - INACTIVE_MS, ERASURES_PER_RUN)
    .all<{ household_id: string; user_id: string; email: string }>()
  let n = 0
  for (const r of rows.results) {
    await deleteAccount(env, { userId: r.user_id, householdId: r.household_id, email: r.email }, { event: 'account_erased_inactive', now })
    n++
  }
  return n
}

/** Expired and finished rows in the app DB. None of these is shown to anyone once past its date. */
async function appRows(env: CleanupEnv, now: number): Promise<number> {
  const db = env.DB
  const nowIso = new Date(now).toISOString()
  return changes(
    await db.batch([
      db.prepare('DELETE FROM rate_limit WHERE reset_at < ?1').bind(now),
      db.prepare('DELETE FROM quota WHERE window < ?1').bind(quotaWindow('day', now - QUOTA_KEEP_MS)),
      db.prepare('DELETE FROM pending_statement_password WHERE expires_at < ?1').bind(now),
      db.prepare(`DELETE FROM parse_job WHERE status IN ('done','failed','expired') AND blob_key IS NULL AND expires_at < ?1`).bind(now - FINISHED_JOB_MS),
      // Better Auth stores dates as ISO text in D1; compare both forms so a change of format can't keep rows forever.
      db.prepare(`DELETE FROM session WHERE "expiresAt" < ?1 OR (typeof("expiresAt") IN ('integer','real') AND "expiresAt" < ?2)`).bind(nowIso, now),
      db.prepare(`DELETE FROM verification WHERE "expiresAt" < ?1 OR (typeof("expiresAt") IN ('integer','real') AND "expiresAt" < ?2)`).bind(nowIso, now),
      db.prepare('DELETE FROM audit_event WHERE at < ?1').bind(now - AUDIT_RETENTION_MS),
      // A skip for an instalment the member's newest statement already covers has done its job (M12).
      db.prepare(
        `DELETE FROM sip_override WHERE kind = 'skip'
           AND due < (SELECT MAX(s.as_of) FROM statement s WHERE s.member_id = sip_override.member_id AND s.household_id = sip_override.household_id)`,
      ),
    ]),
  )
}

/** Public market data: schemes nobody has held for 90 days, and old NAV-run bookkeeping. */
async function marketRows(env: CleanupEnv, now: number): Promise<number> {
  const db = env.MARKET
  return changes(
    await db.batch([
      db.prepare('DELETE FROM tracked_scheme WHERE last_seen_at < ?1').bind(now - TRACKED_UNSEEN_MS),
      db.prepare('DELETE FROM nav_run WHERE at < ?1').bind(now - NAV_RUN_KEEP_MS),
    ]),
  )
}

/**
 * Stocks inside funds (M11): stock_match rows unwanted for 90 days, and every fund_portfolio row (with its R2 blob)
 * that no recently wanted stock_match row reads any more. Builds only read holdings through a wanted stock_match
 * row, so nothing a snapshot uses goes.
 */
async function stockRows(env: CleanupEnv, now: number): Promise<number> {
  const db = env.MARKET
  const cutoff = now - STOCK_UNWANTED_MS
  await db.prepare('DELETE FROM stock_match WHERE wanted_at < ?1').bind(cutoff).run()
  const stale = await db
    .prepare(
      `SELECT scheme_isin, month, blob_key FROM fund_portfolio f
       WHERE NOT EXISTS (SELECT 1 FROM stock_match m WHERE m.isin = f.scheme_isin AND m.wanted_at >= ?1) LIMIT ?2`,
    )
    .bind(cutoff, STOCKS_PER_RUN)
    .all<{ scheme_isin: string; month: string; blob_key: string }>()
  if (!stale.results.length) return 0
  const keys = stale.results.filter((r) => r.blob_key === holdingsKey(r.scheme_isin, r.month)).map((r) => r.blob_key)
  if (keys.length) await env.BUCKET.delete(keys)
  await db.batch(stale.results.map((r) => db.prepare('DELETE FROM fund_portfolio WHERE scheme_isin = ?1 AND month = ?2').bind(r.scheme_isin, r.month)))
  return stale.results.length
}
