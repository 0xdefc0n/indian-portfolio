// pf-email consumer (plan §7.3): one send per message, per-message ack/retry, permanent errors acked.
import { createExecutionContext, createMessageBatch, env, getQueueResult } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { decodeKey, unwrapDek, wrapDek } from '../src/lib/crypto'
import { EmailSendError, errorCode, handleEmailBatch, loginEmail, SINK_DOMAIN, takeSink, type EmailJob, type EmailSender, type LoginEmailJob, type OutgoingEmail } from '../src/lib/email'

const job = (to: string, created_at = Date.now()): LoginEmailJob => ({ kind: 'login', to, link: 'http://localhost:8787/login/verify#token=t', otp: '123456', created_at })

function fakeSender(fail: Record<string, string> = {}) {
  const sent: OutgoingEmail[] = []
  const sender: EmailSender = {
    async send(msg) {
      if (fail[msg.to]) throw new EmailSendError(fail[msg.to]!)
      sent.push(msg)
    },
  }
  return { sender, sent }
}

async function run(jobs: EmailJob[], sender: EmailSender, attempts = 1) {
  const batch = createMessageBatch<EmailJob>('pf-email', jobs.map((body, i) => ({ id: `m${i}`, timestamp: new Date(), attempts, body })))
  const ctx = createExecutionContext()
  await handleEmailBatch(batch, env, sender)
  return getQueueResult(batch, ctx)
}

describe('email consumer', () => {
  it('sends each message separately and acks each one', async () => {
    const { sender, sent } = fakeSender({ 'b@example.com': 'E_RATE_LIMIT_EXCEEDED', 'c@example.com': 'E_RECIPIENT_SUPPRESSED' })
    const r = await run([job('a@example.com'), job('b@example.com'), job('c@example.com'), job('d@example.com')], sender)
    expect(sent.map((m) => m.to)).toEqual(['a@example.com', 'd@example.com'])
    expect(r.explicitAcks.sort()).toEqual(['m0', 'm2', 'm3'])
    expect(r.retryMessages.map((m) => m.msgId)).toEqual(['m1'])
  })

  it('retries the daily limit and unknown errors; acks config errors', async () => {
    const { sender } = fakeSender({ 'a@example.com': 'E_DAILY_LIMIT_EXCEEDED', 'b@example.com': 'E_INTERNAL_SERVER_ERROR', 'c@example.com': 'E_SENDER_NOT_VERIFIED' })
    const r = await run([job('a@example.com'), job('b@example.com'), job('c@example.com')], sender)
    expect(r.retryMessages.map((m) => m.msgId).sort()).toEqual(['m0', 'm1'])
    expect(r.explicitAcks).toEqual(['m2'])
  })

  it('drops a sign-in email that has already expired instead of sending it late', async () => {
    const { sender, sent } = fakeSender()
    const r = await run([job('late@example.com', Date.now() - 11 * 60_000)], sender, 4)
    expect(sent).toHaveLength(0)
    expect(r.explicitAcks).toEqual(['m0'])
  })

  it('sink addresses go to R2, never to the sender', async () => {
    const { sender, sent } = fakeSender()
    const to = `x-${crypto.randomUUID().slice(0, 6)}@${SINK_DOMAIN}`
    await run([job(to)], sender)
    expect(sent).toHaveLength(0)
    expect(await takeSink(env, to)).toMatchObject({ otp: '123456' })
    expect(await takeSink(env, to)).toBeNull() // deleted on read
  })

  it('the email has the link, the code and the expiry, and escapes HTML', () => {
    const m = loginEmail({ ...job('a@example.com'), link: 'http://x/"><script>' }, 10)
    expect(m.text).toContain('123456')
    expect(m.text).toContain('10 minutes')
    expect(m.html).not.toContain('"><script>')
  })

  it('reads the Email Service code from a thrown error, never the message', () => {
    expect(errorCode(Object.assign(new Error('rate limited for a@b.c'), { code: 'E_RATE_LIMIT_EXCEEDED' }))).toBe('E_RATE_LIMIT_EXCEEDED')
    expect(errorCode(new TypeError('bad to: a@b.c'))).toBe('TypeError')
  })
})

describe('DEK wrapping', () => {
  it('accepts the KEK as hex or base64, and rejects anything that is not 32 bytes', () => {
    const hex = 'ab'.repeat(32)
    const b64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(0xab)))
    expect(decodeKey(hex, 'K')).toEqual(decodeKey(b64, 'K'))
    expect(() => decodeKey('abcd', 'K')).toThrow('K must be 32 bytes')
    expect(() => decodeKey(undefined, 'K')).toThrow('K must be 32 bytes')
  })

  it('round-trips, and tampering or another household fails', async () => {
    const dek = crypto.getRandomValues(new Uint8Array(32))
    const wrapped = await wrapDek(env, 'hh-1', dek, 1)
    const key = await unwrapDek(env, 'hh-1', wrapped, 1)
    const iv = new Uint8Array(12)
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array([1, 2, 3]))
    const raw = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['decrypt'])
    expect(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, raw, ct))).toEqual(new Uint8Array([1, 2, 3]))

    const tampered = wrapped.slice()
    tampered[20]! ^= 1
    await expect(unwrapDek(env, 'hh-1', tampered, 1)).rejects.toThrow(/./)
    await expect(unwrapDek(env, 'hh-2', wrapped, 1)).rejects.toThrow(/./)
    await expect(unwrapDek(env, 'hh-1', wrapped, 2)).rejects.toThrow('unknown KEK version')
  })
})
