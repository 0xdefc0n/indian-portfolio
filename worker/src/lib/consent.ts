// DPDP consent (plan §12 Rule 3, §9.2 POST /api/consent). The notice itself is shown by the SPA (web/src/pages/
// consent.tsx); its version lives here and there, and a new version re-prompts everyone.
//
// Gating costs nothing on the hot path: the session carries `consentVersion` (filled at sign-in and after
// POST /api/consent, and so in the signed cookie cache). Only a session that doesn't carry the current version pays
// one D1 query, which checks for a consent row and, if there is one (accepted on another device), stamps the session
// so its next cookie refresh carries it.

/** Bump when the notice's text changes in a way people must agree to again. Must match web/src/lib/legal.ts. */
export const NOTICE_VERSION = '2026-11-26'

/** The session's consent when it carries none for the current notice (one query; also stamps the session row). */
export async function consentFromDb(db: D1Database, userId: string, sessionId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `UPDATE session SET "consentVersion" = ?1
       WHERE id = ?2 AND EXISTS (SELECT 1 FROM consent WHERE user_id = ?3 AND notice_version = ?1 AND withdrawn_at IS NULL)
       RETURNING id`,
    )
    .bind(NOTICE_VERSION, sessionId, userId)
    .first()
  return !!row
}

/** The consent row and every session of the user, in one batch with the caller's audit row. */
export function recordConsentStatements(db: D1Database, userId: string, now = Date.now()): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO consent (user_id, notice_version, accepted_at, withdrawn_at) VALUES (?1, ?2, ?3, NULL)
         ON CONFLICT (user_id, notice_version) DO UPDATE SET accepted_at = excluded.accepted_at, withdrawn_at = NULL`,
      )
      .bind(userId, NOTICE_VERSION, now),
    db.prepare(`UPDATE session SET "consentVersion" = ?1 WHERE "userId" = ?2`).bind(NOTICE_VERSION, userId),
  ]
}
