// Fixed-window rate limits in D1 (plan §7.1). One atomic UPSERT per check, so it holds across isolates and under
// concurrency (Better Auth's own "database" storage costs 2-4 queries per request). Used as Better Auth's
// customStorage for its endpoints and directly by /api/login/email. Keys are HMACed: no IP or email is stored.
import type { BetterAuthRateLimitStorage } from 'better-auth'
import { hmacHex } from './crypto'

export type RateRule = { window: number; max: number } // window in seconds

export async function consume(db: D1Database, secret: string, key: string, rule: RateRule, now = Date.now()) {
  const row = await db
    .prepare(
      `INSERT INTO rate_limit (key, count, reset_at) VALUES (?1, 1, ?2 + ?3)
       ON CONFLICT (key) DO UPDATE SET
         count    = CASE WHEN reset_at <= ?2 THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ?2 THEN ?2 + ?3 ELSE reset_at END
       RETURNING count, reset_at`,
    )
    .bind(await hmacHex(secret, `rl:${key}`), now, rule.window * 1000)
    .first<{ count: number; reset_at: number }>()
  if (!row || row.count <= rule.max) return { allowed: true, retryAfter: null }
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((row.reset_at - now) / 1000)) }
}

export function d1RateLimitStorage(db: D1Database, secret: string): BetterAuthRateLimitStorage {
  return { consume: (key, rule) => consume(db, secret, key, rule) }
}
