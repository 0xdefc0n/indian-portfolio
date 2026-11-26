// One login owns one household (D1). It is created with its wrapped DEK and an empty snapshot row the first time a
// session is created for the user, i.e. on signup, by any sign-in method (plan §6, §7.1).
import { blobKeys, deletePrefix } from './blob'
import { NOTICE_VERSION } from './consent'
import { newWrappedDek } from './crypto'

type HouseholdEnv = { DB: D1Database; DATA_KEK_V1: string }

/**
 * The user's household id, creating the household (and its empty snapshot row) if it doesn't exist yet.
 * One D1 round trip (a batch is one transaction). Safe under concurrent first sign-ins: the UNIQUE owner_user_id
 * keeps the first row, and a losing DEK is simply discarded. Also stamps last_active_at, which drives prebuilds and
 * the DPDP inactivity job (and cancels a pending inactivity notice: signing in keeps the account, Rule 8(2)).
 * Also says whether the user has accepted the current consent notice, which the session then carries (M14).
 */
export async function ensureHousehold(env: HouseholdEnv, userId: string, now = Date.now()): Promise<{ householdId: string; consentVersion: string | null }> {
  const id = crypto.randomUUID()
  const { wrapped, kekVersion } = await newWrappedDek(env, id)
  const [, , found, consent] = await env.DB.batch<{ id: string }>([
    env.DB.prepare(
      `INSERT INTO household (id, owner_user_id, dek_wrapped, kek_version, created_at, last_active_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (owner_user_id) DO UPDATE SET last_active_at = excluded.last_active_at, inactivity_notice_at = NULL`,
    ).bind(id, userId, wrapped, kekVersion, now),
    env.DB.prepare(
      `INSERT INTO snapshot (household_id, status) SELECT id, 'ready' FROM household WHERE owner_user_id = ?1
       ON CONFLICT (household_id) DO NOTHING`,
    ).bind(userId),
    env.DB.prepare('SELECT id FROM household WHERE owner_user_id = ?1').bind(userId),
    env.DB.prepare('SELECT notice_version AS id FROM consent WHERE user_id = ?1 AND notice_version = ?2 AND withdrawn_at IS NULL').bind(userId, NOTICE_VERSION),
  ])
  const householdId = found?.results[0]?.id
  if (!householdId) throw new HouseholdError('household not created')
  return { householdId, consentVersion: consent?.results[0]?.id ?? null }
}

/**
 * The user is still using the app (Better Auth refreshes a session once a day while it's used): stamp
 * last_active_at and cancel a pending inactivity notice. One write per user per day at most.
 */
export async function touchHousehold(db: D1Database, userId: string, now = Date.now()): Promise<void> {
  await db
    .prepare('UPDATE household SET last_active_at = ?1, inactivity_notice_at = NULL WHERE owner_user_id = ?2 AND last_active_at < ?1')
    .bind(now, userId)
    .run()
}

export class HouseholdError extends Error {
  override name = 'HouseholdError'
}

/**
 * Crypto-shred a household (plan §8): destroy the wrapped DEK first, so every sealed blob and column is unreadable
 * from that moment (including D1 Time Travel copies), then delete its R2 prefixes h/{id}/ and tmp/{id}/, then its
 * rows (member, statement, parse_job, pending passwords, SIP changes and snapshot cascade). The user and session rows
 * are removed by account deletion (lib/account.ts), which calls this.
 */
export async function shredHousehold(env: { DB: D1Database; BUCKET: R2Bucket }, householdId: string): Promise<{ objects: number }> {
  await env.DB.prepare("UPDATE household SET dek_wrapped = x'', kek_version = 0 WHERE id = ?1").bind(householdId).run()
  const objects = (await deletePrefix(env, blobKeys.householdPrefix(householdId))) + (await deletePrefix(env, blobKeys.tmpPrefix(householdId)))
  await env.DB.prepare('DELETE FROM household WHERE id = ?1').bind(householdId).run()
  return { objects }
}
