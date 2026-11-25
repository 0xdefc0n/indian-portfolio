// One login owns one household (D1). It is created with its wrapped DEK and an empty snapshot row the first time a
// session is created for the user, i.e. on signup, by any sign-in method (plan §6, §7.1).
import { newWrappedDek } from './crypto'

type HouseholdEnv = { DB: D1Database; DATA_KEK_V1: string }

/**
 * The user's household id, creating the household (and its empty snapshot row) if it doesn't exist yet.
 * One D1 round trip (a batch is one transaction). Safe under concurrent first sign-ins: the UNIQUE owner_user_id
 * keeps the first row, and a losing DEK is simply discarded. Also stamps last_active_at, which drives prebuilds and
 * the DPDP inactivity job.
 */
export async function ensureHousehold(env: HouseholdEnv, userId: string, now = Date.now()): Promise<string> {
  const id = crypto.randomUUID()
  const { wrapped, kekVersion } = await newWrappedDek(env, id)
  const [, , found] = await env.DB.batch<{ id: string }>([
    env.DB.prepare(
      `INSERT INTO household (id, owner_user_id, dek_wrapped, kek_version, created_at, last_active_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (owner_user_id) DO UPDATE SET last_active_at = excluded.last_active_at`,
    ).bind(id, userId, wrapped, kekVersion, now),
    env.DB.prepare(
      `INSERT INTO snapshot (household_id, status) SELECT id, 'ready' FROM household WHERE owner_user_id = ?1
       ON CONFLICT (household_id) DO NOTHING`,
    ).bind(userId),
    env.DB.prepare('SELECT id FROM household WHERE owner_user_id = ?1').bind(userId),
  ])
  const householdId = found?.results[0]?.id
  if (!householdId) throw new HouseholdError('household not created')
  return householdId
}

export class HouseholdError extends Error {
  override name = 'HouseholdError'
}
