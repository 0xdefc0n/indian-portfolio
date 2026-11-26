// QR device login and Settings → Devices (plan §7.4, §16 "Auth": QR flow). One account, many devices (D2).
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { deviceLabel } from '../src/lib/devices'
import { call, Jar, signInWithCode, sinkAddress, sinkHeaders } from './helpers/auth'

const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const MUMBAI = { city: 'Mumbai', country: 'IN' }

let ipSeq = 0
const freshIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`

type Me = { user: { email: string }; household: { id: string }; consent_ok: boolean; new_devices: { label: string; city: string | null }[] }
const me = (jar: Jar) => call('/api/me', { jar })
const meJson = async (jar: Jar) => (await me(jar)).json<Me>()
const userCount = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first<{ n: number }>())!.n

/** A signed-out browser asking for a QR code. */
async function newDevice(opts: { ip?: string; ua?: string } = {}) {
  const jar = new Jar()
  const headers = { 'cf-connecting-ip': opts.ip ?? freshIp(), 'user-agent': opts.ua ?? MAC_CHROME }
  const res = await call('/api/login/qr', { body: {}, jar, headers, cf: MUMBAI })
  expect(res.status).toBe(200)
  const code = await res.json<{ device_code: string; user_code: string; verification_uri_complete: string; expires_in: number; interval: number }>()
  /** Polls once, skipping the 5 s interval (the plugin answers slow_down otherwise). */
  const poll = async () => {
    await env.DB.prepare('UPDATE "deviceCode" SET "lastPolledAt" = NULL WHERE "deviceCode" = ?1').bind(code.device_code).run()
    const r = await call('/api/login/qr/poll', { body: { device_code: code.device_code }, jar, headers, cf: MUMBAI })
    return { status: r.status, body: await r.json<{ status: string; access_token?: string }>() }
  }
  return { jar, code, poll, headers }
}

const userCodeOf = (uri: string) => new URL(uri).searchParams.get('user_code')!
const lookup = (jar: Jar | undefined, userCode: string) => call(`/api/link?user_code=${encodeURIComponent(userCode)}`, { jar })
const approve = (jar: Jar | undefined, userCode: string) => call('/api/link/approve', { body: { user_code: userCode }, jar })
const deny = (jar: Jar | undefined, userCode: string) => call('/api/link/deny', { body: { user_code: userCode }, jar })

describe('QR login', () => {
  it('approve: the new device signs in to the approver’s own user and household, with no new user and no email', async () => {
    const email = sinkAddress('qr')
    const phone = await signInWithCode(email, new Jar(), freshIp())
    const before = await meJson(phone)
    const users = await userCount()

    const desk = await newDevice()
    expect(desk.code.verification_uri_complete).toMatch(/^http:\/\/localhost:8787\/link\?user_code=[A-Z0-9]{8}$/)
    expect(desk.code.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect([desk.code.expires_in, desk.code.interval]).toEqual([300, 5])
    expect((await desk.poll()).body.status).toBe('pending')

    const userCode = userCodeOf(desk.code.verification_uri_complete)
    const shown = await lookup(phone, desk.code.user_code) // typed with the dash works too
    expect(shown.status).toBe(200)
    const info = await shown.json<{ user_code: string; device: { label: string; city: string; country: string }; expires_at: number }>()
    expect(info.user_code).toBe(desk.code.user_code)
    expect(info.device).toEqual({ label: 'Chrome · macOS', city: 'Mumbai', country: 'IN' })
    expect(info.expires_at).toBeGreaterThan(Date.now())

    expect((await approve(phone, userCode)).status).toBe(200)
    const done = await desk.poll()
    expect(done).toEqual({ status: 200, body: { ok: true, status: 'approved' } }) // no token in the body
    expect([...desk.jar.cookies.keys()].some((k) => k.endsWith('session_token'))).toBe(true)

    const linked = await meJson(desk.jar)
    expect(linked.user.email).toBe(email)
    expect(linked.household.id).toBe(before.household.id)
    expect(linked.consent_ok).toBe(true) // the account's consent; no consent step on the new device
    expect(linked.new_devices).toEqual([]) // never about itself
    expect(await userCount()).toBe(users)

    const row = await env.DB.prepare('SELECT "householdId" AS h, "linkedAt" AS linked, city, country FROM session s JOIN user u ON u.id = s."userId" WHERE u.email = ?1 AND "linkedAt" IS NOT NULL')
      .bind(email).first<{ h: string; linked: number; city: string; country: string }>()
    expect(row).toMatchObject({ h: before.household.id, city: 'Mumbai', country: 'IN' })
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_event WHERE household_id = ?1 AND event = 'device_linked'").bind(before.household.id).first<{ n: number }>()
    expect(audit!.n).toBe(1)
    // No "new device" email: nothing reached the sink after the sign-in email (which signInWithCode took).
    expect((await call(`/api/test/email-sink?to=${encodeURIComponent(email)}`, { headers: sinkHeaders() })).status).toBe(404)
    // The device data the user can act on reaches the dashboard straight away.
    expect((await call('/api/portfolio', { jar: desk.jar })).status).toBe(200)
  })

  it('the other device gets the "New device linked" notice once', async () => {
    const email = sinkAddress('qr')
    const phone = await signInWithCode(email, new Jar(), freshIp())
    const tablet = await signInWithCode(email, new Jar(), freshIp())
    expect((await meJson(phone)).new_devices).toEqual([])

    const desk = await newDevice()
    const userCode = userCodeOf(desk.code.verification_uri_complete)
    expect((await lookup(phone, userCode)).status).toBe(200)
    expect((await approve(phone, userCode)).status).toBe(200)
    expect((await desk.poll()).body.status).toBe('approved')

    expect((await meJson(phone)).new_devices).toEqual([{ label: 'Chrome · macOS', city: 'Mumbai', country: 'IN' }])
    expect((await meJson(phone)).new_devices).toEqual([])
    // Each other device sees it once, on its own.
    expect((await meJson(tablet)).new_devices).toHaveLength(1)
    expect((await meJson(tablet)).new_devices).toEqual([])
    // A device that signs in later never sees it.
    const later = await signInWithCode(email, new Jar(), freshIp())
    expect((await meJson(later)).new_devices).toEqual([])
  })

  it('deny: the new device gets "denied" and no session', async () => {
    const phone = await signInWithCode(sinkAddress('qr'), new Jar(), freshIp())
    const desk = await newDevice()
    const userCode = userCodeOf(desk.code.verification_uri_complete)
    expect((await lookup(phone, userCode)).status).toBe(200)
    expect((await deny(phone, userCode)).status).toBe(200)
    expect((await approve(phone, userCode)).status).toBe(409) // decided already
    expect((await desk.poll()).body.status).toBe('denied')
    expect((await me(desk.jar)).status).toBe(401)
  })

  it('an expired code can be neither shown, approved nor redeemed', async () => {
    const phone = await signInWithCode(sinkAddress('qr'), new Jar(), freshIp())
    const desk = await newDevice()
    const userCode = userCodeOf(desk.code.verification_uri_complete)
    expect((await lookup(phone, userCode)).status).toBe(200)
    await env.DB.prepare('UPDATE "deviceCode" SET "expiresAt" = ?1 WHERE "userCode" = ?2').bind(new Date(Date.now() - 1000).toISOString(), userCode).run()
    expect((await lookup(phone, userCode)).status).toBe(410)
    expect((await approve(phone, userCode)).status).toBe(410)
    expect((await desk.poll()).body.status).toBe('expired')
    expect((await me(desk.jar)).status).toBe(401)
  })

  it('a code works once: redeemed codes are gone for both sides', async () => {
    const email = sinkAddress('qr')
    const phone = await signInWithCode(email, new Jar(), freshIp())
    const desk = await newDevice()
    const userCode = userCodeOf(desk.code.verification_uri_complete)
    await lookup(phone, userCode)
    await approve(phone, userCode)
    expect((await desk.poll()).body.status).toBe('approved')

    const thief = new Jar()
    const again = await call('/api/login/qr/poll', { body: { device_code: desk.code.device_code }, jar: thief, headers: desk.headers })
    expect((await again.json<{ status: string }>()).status).toBe('expired')
    expect((await me(thief)).status).toBe(401)
    expect((await lookup(phone, userCode)).status).toBe(404)
    expect((await approve(phone, userCode)).status).toBe(404)
    const linked = await env.DB.prepare('SELECT COUNT(*) AS n FROM session s JOIN user u ON u.id = s."userId" WHERE u.email = ?1 AND s."linkedAt" IS NOT NULL')
      .bind(email).first<{ n: number }>()
    expect(linked!.n).toBe(1)
  })

  it('approving while signed out is refused', async () => {
    const desk = await newDevice()
    const userCode = userCodeOf(desk.code.verification_uri_complete)
    expect((await lookup(undefined, userCode)).status).toBe(401)
    expect((await approve(undefined, userCode)).status).toBe(401)
    expect((await deny(undefined, userCode)).status).toBe(401)
    expect((await desk.poll()).body.status).toBe('pending')
  })

  it('a code claimed by one account looks like a wrong code to any other account', async () => {
    const phone = await signInWithCode(sinkAddress('qr'), new Jar(), freshIp())
    const other = await signInWithCode(sinkAddress('qr'), new Jar(), freshIp())
    const desk = await newDevice()
    const userCode = userCodeOf(desk.code.verification_uri_complete)
    expect((await lookup(phone, userCode)).status).toBe(200)
    expect((await lookup(other, userCode)).status).toBe(404)
    expect((await approve(other, userCode)).status).toBe(404)
    expect((await lookup(other, 'ZZZZZZZZ')).status).toBe(404)
    // Approving without looking first (the code isn't claimed) is refused too.
    const desk2 = await newDevice()
    expect((await approve(other, userCodeOf(desk2.code.verification_uri_complete))).status).toBe(404)
  })

  it('device codes are limited to 10 an hour per IP', async () => {
    const ip = freshIp()
    for (let i = 0; i < 10; i++) expect((await call('/api/login/qr', { body: {}, headers: { 'cf-connecting-ip': ip } })).status).toBe(200)
    const res = await call('/api/login/qr', { body: {}, headers: { 'cf-connecting-ip': ip } })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it("Better Auth's own device and session-list endpoints are not routed", async () => {
    const phone = await signInWithCode(sinkAddress('qr'), new Jar(), freshIp())
    expect((await call('/api/auth/device/code', { body: { client_id: 'web-qr' } })).status).toBe(404)
    expect((await call('/api/auth/device/approve', { body: { userCode: 'ABCDEFGH' }, jar: phone })).status).toBe(404)
    expect((await call('/api/auth/list-sessions', { jar: phone })).status).toBe(404)
  })
})

describe('Settings → Devices', () => {
  type Device = { id: string; label: string; city: string | null; current: boolean; new: boolean; last_active_at: number }
  const devices = async (jar: Jar) => (await (await call('/api/devices', { jar })).json<{ devices: Device[] }>()).devices

  it('lists this account’s sessions, current first, with the QR-linked one marked new', async () => {
    const email = sinkAddress('dev')
    const phone = await signInWithCode(email, new Jar(), freshIp())
    const desk = await newDevice()
    const userCode = userCodeOf(desk.code.verification_uri_complete)
    await lookup(phone, userCode)
    await approve(phone, userCode)
    await desk.poll()

    const list = await devices(phone)
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ current: true, new: false })
    expect(list[1]).toMatchObject({ current: false, new: true, label: 'Chrome · macOS', city: 'Mumbai' })
    expect(JSON.stringify(list)).not.toMatch(/token/i)
    // Another account sees only its own.
    expect(await devices(await signInWithCode(sinkAddress('dev'), new Jar(), freshIp()))).toHaveLength(1)
  })

  it('signing out one device ends that session; the current one and other accounts’ are refused', async () => {
    const email = sinkAddress('dev')
    const a = await signInWithCode(email, new Jar(), freshIp())
    const b = await signInWithCode(email, new Jar(), freshIp())
    const other = await signInWithCode(sinkAddress('dev'), new Jar(), freshIp())
    const [mine, theirs] = [await devices(a), await devices(other)]
    const current = mine.find((d) => d.current)!
    const bId = mine.find((d) => !d.current)!.id

    expect((await call(`/api/devices/${current.id}`, { method: 'DELETE', jar: a })).status).toBe(400)
    expect((await call(`/api/devices/${theirs[0]!.id}`, { method: 'DELETE', jar: a })).status).toBe(404)
    expect((await devices(other))).toHaveLength(1)
    expect((await call(`/api/devices/${bId}`, { method: 'DELETE', jar: a })).status).toBe(200)
    expect((await call('/api/devices', { jar: b })).status).toBe(401) // fresh routes see it at once
    expect((await me(b.without('session_data'))).status).toBe(401)
    expect(await devices(a)).toHaveLength(1)
  })

  it('"Sign out all other devices" keeps only this one', async () => {
    const email = sinkAddress('dev')
    const a = await signInWithCode(email, new Jar(), freshIp())
    const b = await signInWithCode(email, new Jar(), freshIp())
    await signInWithCode(email, new Jar(), freshIp())
    const res = await call('/api/devices/sign-out-others', { body: {}, jar: a })
    expect(await res.json()).toEqual({ ok: true, signed_out: 2 })
    expect(await devices(a)).toHaveLength(1)
    expect((await me(b.without('session_data'))).status).toBe(401)
    expect((await me(a)).status).toBe(200)
  })

  it('a sign-in records the approximate place Cloudflare saw, outside the cookie cache', async () => {
    const email = sinkAddress('dev')
    const jar = new Jar()
    const { requestLoginEmail } = await import('./helpers/auth')
    const mail = await requestLoginEmail(email)
    const res = await call('/api/auth/sign-in/email-otp', { body: { email, otp: mail.otp }, jar, cf: { city: 'Pune', country: 'IN' }, headers: { 'cf-connecting-ip': freshIp() } })
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT city, country FROM session s JOIN user u ON u.id = s."userId" WHERE u.email = ?1').bind(email).first()
    expect(row).toEqual({ city: 'Pune', country: 'IN' })
    const cache = [...jar.cookies].find(([k]) => k.endsWith('session_data'))![1]
    expect(decodeURIComponent(cache)).not.toContain('Pune')
  })
})

describe('deviceLabel', () => {
  it.each([
    [MAC_CHROME, 'Chrome · macOS'],
    [IPHONE_SAFARI, 'Safari · iPhone'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', 'Edge · Windows'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36', 'Chrome · Android'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36', 'Samsung Internet · Android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox · macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1', 'Chrome · iPhone'],
    ['curl/8.7.1', 'Unknown device'],
    [null, 'Unknown device'],
  ])('%s', (ua, label) => expect(deviceLabel(ua)).toBe(label))
})
