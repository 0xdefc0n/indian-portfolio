// QR device login (plan §7.4, D2) and Settings → Devices (§13 item 7).
//
//   New device (signed out)                         Signed-in phone
//   POST /api/login/qr        → codes + QR URL
//                                                   GET  /api/link?user_code=…   (claims the code, shows the device)
//                                                   POST /api/link/approve | /api/link/deny
//   POST /api/login/qr/poll   → pending … approved: the session cookie is set on this response (the cookie bridge)
//
// Better Auth's own /device* endpoints aren't routed (src/routes/auth.ts); these call them through auth.api, so the
// session token never reaches the page's JavaScript. The linked device signs in to the approver's own user: same
// user, same household, no new user row, no email. Its other devices see a one-time notice via /api/me.
import { APIError } from 'better-auth/api'
import { type Context, Hono } from 'hono'
import { createAuth } from '../auth'
import { auditStatement, requestMeta } from '../lib/audit'
import {
  dateMs, deviceLabel, formatUserCode, LINK_LOOKUPS_PER_USER, NEW_DEVICE_MS, normalizeUserCode, QR_CLIENT_ID,
  QR_CODES_PER_IP, requestPlace,
} from '../lib/devices'
import { ApiError, notFound } from '../lib/errors'
import { consume } from '../lib/rate-limit'
import { requireSession } from '../middleware/session'
import type { AppBindings } from '../types'

export const deviceRoutes = new Hono<AppBindings>()
// Approving a device and listing or ending sessions always read the session from D1: a revoked device can't use
// its cookie cache to approve another one (§7.1).
const fresh = requireSession({ fresh: true })

/** The plugin's OAuth-style error code ("authorization_pending", "expired_token", …), or null. */
const authError = (e: unknown) => (e instanceof APIError ? String((e.body as { error?: unknown } | undefined)?.error ?? '') : null)

// ─── New device ──────────────────────────────────────────────────────────────────────────────────────────────────

deviceRoutes.post('/login/qr', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'none'
  const rl = await consume(c.env.DB, c.env.BETTER_AUTH_SECRET, `login-qr:ip:${ip}`, QR_CODES_PER_IP)
  if (!rl.allowed) throw new ApiError(429, 'qr_limit', { retry_after: rl.retryAfter })

  const res = await createAuth(c.env).api.deviceCode({ body: { client_id: QR_CLIENT_ID }, headers: c.req.raw.headers })
  const place = requestPlace(c.req.raw)
  await c.env.DB.prepare('INSERT INTO device_code_meta (user_code, label, city, country, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(res.user_code, deviceLabel(c.req.header('user-agent')), place.city, place.country, Date.now())
    .run()
  c.header('Cache-Control', 'no-store')
  return c.json({
    ok: true,
    device_code: res.device_code,
    user_code: formatUserCode(res.user_code),
    verification_uri_complete: res.verification_uri_complete,
    expires_in: res.expires_in,
    interval: res.interval,
  })
})

type PollStatus = 'pending' | 'slow_down' | 'approved' | 'denied' | 'expired'

deviceRoutes.post('/login/qr/poll', async (c) => {
  const body = await c.req.json<{ device_code?: unknown }>().catch(() => null)
  const deviceCode = typeof body?.device_code === 'string' ? body.device_code.slice(0, 191) : ''
  if (!deviceCode) throw new ApiError(400, 'invalid_request')
  c.header('Cache-Control', 'no-store')
  const status = (s: PollStatus) => c.json({ ok: true, status: s })

  let issued: { headers: Headers; response: { access_token: string } }
  try {
    issued = await createAuth(c.env).api.deviceToken({
      body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: QR_CLIENT_ID },
      headers: c.req.raw.headers,
      returnHeaders: true,
    })
  } catch (e) {
    const code = authError(e)
    if (code === 'authorization_pending') return status('pending')
    if (code === 'slow_down') return status('slow_down')
    if (code === 'access_denied') return status('denied')
    if (code === 'expired_token' || code === 'invalid_grant') return status('expired') // used, expired or unknown
    throw e
  }

  // The session now exists (the approver's user and household, from the session.create hook). Mark it as linked by
  // QR, with this device's place, and write the security log row. The token itself is not sent back.
  const place = requestPlace(c.req.raw)
  const meta = await requestMeta(c)
  const now = Date.now()
  const session = await c.env.DB.prepare('SELECT id, "userId" AS user_id, "householdId" AS household_id FROM session WHERE token = ?1')
    .bind(issued.response.access_token)
    .first<{ id: string; user_id: string; household_id: string | null }>()
  if (!session) throw new Error('device session missing')
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE session SET "linkedAt" = ?1, city = COALESCE(?2, city), country = COALESCE(?3, country) WHERE id = ?4')
      .bind(now, place.city, place.country, session.id),
    c.env.DB.prepare('INSERT INTO audit_event (user_id, household_id, event, ip_country, ua_hash, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(session.user_id, session.household_id, 'device_linked', meta.country, meta.uaHash, now),
  ])
  for (const v of issued.headers.getSetCookie()) c.header('Set-Cookie', v, { append: true })
  return status('approved')
})

// ─── Approving device (/link) ────────────────────────────────────────────────────────────────────────────────────

const userCodeFrom = (v: unknown) => (typeof v === 'string' ? normalizeUserCode(v) : '')

/**
 * Shows the requesting device and claims the code for this user (the plugin's GET /device). Only the user who
 * claimed it first can see or approve it; anyone else gets the same 404 as for a wrong code.
 */
deviceRoutes.get('/link', fresh, async (c) => {
  const userCode = userCodeFrom(c.req.query('user_code'))
  if (!userCode) throw new ApiError(400, 'invalid_code')
  const rl = await consume(c.env.DB, c.env.BETTER_AUTH_SECRET, `link:user:${c.var.user.id}`, LINK_LOOKUPS_PER_USER)
  if (!rl.allowed) throw new ApiError(429, 'link_limit', { retry_after: rl.retryAfter })

  let verified: { status: string; client_id?: string }
  try {
    verified = await createAuth(c.env).api.deviceVerify({ query: { user_code: userCode }, headers: c.req.raw.headers })
  } catch (e) {
    const code = authError(e)
    if (code === 'expired_token') throw new ApiError(410, 'code_expired')
    if (code === 'invalid_request') throw new ApiError(404, 'invalid_code')
    throw e
  }
  if (!verified.client_id) throw new ApiError(404, 'invalid_code') // claimed by another account
  if (verified.status !== 'pending') throw new ApiError(409, 'already_used')

  const row = await c.env.DB.prepare(
    `SELECT d."expiresAt" AS expires_at, m.label, m.city, m.country
     FROM "deviceCode" d LEFT JOIN device_code_meta m ON m.user_code = d."userCode" WHERE d."userCode" = ?1`,
  ).bind(userCode).first<{ expires_at: unknown; label: string | null; city: string | null; country: string | null }>()
  if (!row) throw new ApiError(404, 'invalid_code')
  return c.json({
    ok: true,
    user_code: formatUserCode(userCode),
    device: { label: row.label ?? 'Unknown device', city: row.city, country: row.country },
    expires_at: dateMs(row.expires_at),
  })
})

async function decide(c: Context<AppBindings>, approve: boolean) {
  const body = await c.req.json<{ user_code?: unknown }>().catch(() => null)
  const userCode = userCodeFrom(body?.user_code)
  if (!userCode) throw new ApiError(400, 'invalid_code')
  const api = createAuth(c.env).api
  try {
    const args = { body: { userCode }, headers: c.req.raw.headers }
    await (approve ? api.deviceApprove(args) : api.deviceDeny(args))
  } catch (e) {
    const err = e instanceof APIError ? (e.body as { error?: string; error_description?: string } | undefined) : undefined
    if (err?.error === 'expired_token') throw new ApiError(410, 'code_expired')
    if (err?.error === 'invalid_request' && /already processed/i.test(err.error_description ?? '')) throw new ApiError(409, 'already_used')
    if (err?.error === 'invalid_request' || err?.error === 'access_denied') throw new ApiError(404, 'invalid_code')
    throw e
  }
  if (!approve) await auditStatement(c, 'device_denied').then((s) => s.run())
  return c.json({ ok: true })
}

deviceRoutes.post('/link/approve', fresh, (c) => decide(c, true))
deviceRoutes.post('/link/deny', fresh, (c) => decide(c, false))

// ─── Settings → Devices ──────────────────────────────────────────────────────────────────────────────────────────

type SessionRow = {
  id: string
  userAgent: string | null
  city: string | null
  country: string | null
  createdAt: unknown
  updatedAt: unknown
  expiresAt: unknown
  linkedAt: number | null
}

deviceRoutes.get('/devices', fresh, async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, "userAgent", city, country, "createdAt", "updatedAt", "expiresAt", "linkedAt" FROM session WHERE "userId" = ?1',
  ).bind(c.var.user.id).all<SessionRow>()
  const now = Date.now()
  const devices = rows.results
    .filter((r) => (dateMs(r.expiresAt) ?? 0) > now)
    .map((r) => ({
      id: r.id,
      label: deviceLabel(r.userAgent),
      city: r.city,
      country: r.country,
      signed_in_at: dateMs(r.createdAt),
      last_active_at: dateMs(r.updatedAt),
      current: r.id === c.var.sessionId,
      new: r.linkedAt !== null && now - r.linkedAt < NEW_DEVICE_MS,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || (b.last_active_at ?? 0) - (a.last_active_at ?? 0))
  c.header('Cache-Control', 'no-store')
  return c.json({ devices })
})

// Ending a session takes effect at once on routes that read D1, and within the 5-minute cookie cache elsewhere.
deviceRoutes.delete('/devices/:id', fresh, async (c) => {
  const id = c.req.param('id')
  if (id === c.var.sessionId) throw new ApiError(400, 'current_device') // that's "Sign out"
  const [del] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM session WHERE id = ?1 AND "userId" = ?2').bind(id, c.var.user.id),
    await auditStatement(c, 'device_signed_out', { onlyIfChanged: true }),
  ])
  if (!del?.meta.changes) throw notFound()
  return c.json({ ok: true })
})

deviceRoutes.post('/devices/sign-out-others', fresh, async (c) => {
  const [del] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM session WHERE "userId" = ?1 AND id <> ?2').bind(c.var.user.id, c.var.sessionId),
    await auditStatement(c, 'device_signed_out', { onlyIfChanged: true }),
  ])
  return c.json({ ok: true, signed_out: del?.meta.changes ?? 0 })
})
