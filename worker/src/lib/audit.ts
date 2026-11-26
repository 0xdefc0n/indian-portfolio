// Security log rows (plan §6 audit_event). No PII: opaque ids, the country Cloudflare saw, and an HMAC of the user
// agent (so a new device stands out without storing the string). Returned as a statement to join the caller's batch.
import type { Context } from 'hono'
import type { AppBindings } from '../types'
import { hmacHex } from './crypto'

export type AuditEvent = 'member_renamed' | 'member_deleted' | 'statement_added' | 'statement_deleted' | 'sip_skipped' | 'sip_skip_undone' | 'sip_cancelled'

/**
 * INSERT for one audit row. With `onlyIfChanged`, the row is written only when the previous statement in the same
 * batch changed a row (SQLite changes()), so a 404 delete leaves no audit trail of a guess.
 */
export async function auditStatement(c: Context<AppBindings>, event: AuditEvent, opts: { onlyIfChanged?: boolean } = {}) {
  const ua = c.req.header('user-agent')
  const uaHash = ua ? (await hmacHex(c.env.BETTER_AUTH_SECRET, `ua:${ua}`)).slice(0, 16) : null
  const country = (c.req.raw.cf as { country?: string } | undefined)?.country ?? null
  return c.env.DB.prepare(
    `INSERT INTO audit_event (user_id, household_id, event, ip_country, ua_hash, at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6 ${opts.onlyIfChanged ? 'WHERE changes() > 0' : ''}`,
  ).bind(c.var.user.id, c.var.householdId, event, country, uaHash, Date.now())
}

/** An audit row for work done outside a request (the parse consumer): no country or user agent to record. */
export function auditJobStatement(db: D1Database, row: { userId: string | null; householdId: string; event: AuditEvent }) {
  return db
    .prepare('INSERT INTO audit_event (user_id, household_id, event, ip_country, ua_hash, at) VALUES (?1, ?2, ?3, NULL, NULL, ?4)')
    .bind(row.userId, row.householdId, row.event, Date.now())
}
