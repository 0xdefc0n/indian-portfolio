// Email (plan §7.3, D5). Everything goes through the pf-email queue: the consumer sends each message with its own
// EmailSender.send() call (Email Service has no batch endpoint) and acks or retries each one separately.
// Privacy (§0.1): addresses, links and codes are never logged. Logs carry the error code and counts only.
import { hmacHex, safeEqual } from './crypto'

export type OutgoingEmail = { to: string; subject: string; html: string; text: string }

export interface EmailSender {
  /** Resolves when accepted. Throws EmailSendError with a code; never includes the address in the error. */
  send(msg: OutgoingEmail): Promise<void>
}

/** Queue message on pf-email. One sign-in email holds both the link and the 6-digit code (§13A.5). */
export type LoginEmailJob = { kind: 'login'; to: string; link: string; otp: string; created_at: number }
/** "Your account was deleted" (§7.3): after DELETE /api/account, or the DPDP inactivity erasure (`reason: 'inactive'`). */
export type DeletedEmailJob = { kind: 'account_deleted'; to: string; reason: 'user' | 'inactive'; created_at: number }
/** The DPDP inactivity notice (§12, Rule 8(2)): sign in before `erase_on` (an IST date) to keep the account. */
export type InactivityEmailJob = { kind: 'inactivity_notice'; to: string; erase_on: string; created_at: number }
export type EmailJob = LoginEmailJob | DeletedEmailJob | InactivityEmailJob

export class EmailSendError extends Error {
  override name = 'EmailSendError'
  constructor(readonly code: string) {
    super(code)
  }
}

// ─── Cloudflare Email Service (send_email binding) ───────────────────────────────────────────────────────────────

export class CloudflareEmailSender implements EmailSender {
  constructor(private binding: SendEmail, private from: { name: string; email: string }) {}

  async send(msg: OutgoingEmail): Promise<void> {
    try {
      await this.binding.send({ from: this.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text })
    } catch (e) {
      throw new EmailSendError(errorCode(e))
    }
  }
}

/** The Email Service code (E_…) from a thrown error, or the error's class name. Never the message text. */
export function errorCode(e: unknown): string {
  const code = (e as { code?: unknown })?.code
  if (typeof code === 'string' && /^E_[A-Z_]+$/.test(code)) return code
  const m = /\bE_[A-Z_]{3,}\b/.exec(String((e as Error)?.message ?? ''))
  return m ? m[0] : ((e as Error)?.name ?? 'Error')
}

type Disposition = { action: 'ack'; alert?: boolean } | { action: 'retry'; delaySeconds: number; alert?: boolean }

// Codes from developers.cloudflare.com/email-service/api/send-emails/workers-api/#error-codes (checked 2026-11-25).
// The docs don't classify them; this split is ours. Config problems are dropped with an alert: retrying can't fix
// them, and a sign-in email is useless after it expires anyway.
const PERMANENT = new Set([
  'E_VALIDATION_ERROR', 'E_FIELD_MISSING', 'E_TOO_MANY_RECIPIENTS', 'E_TOO_MANY_ATTACHMENTS', 'E_CONTENT_TOO_LARGE',
  'E_RECIPIENT_NOT_ALLOWED', 'E_RECIPIENT_SUPPRESSED', 'E_DELIVERY_FAILED',
  'E_HEADER_NOT_ALLOWED', 'E_HEADER_USE_API_FIELD', 'E_HEADER_VALUE_INVALID', 'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID', 'E_HEADERS_TOO_LARGE', 'E_HEADERS_TOO_MANY',
  'TypeError', // send() argument didn't match the interface: a bug, not a transient failure
])
const CONFIG = new Set([
  'E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_SENDER_DOMAIN_NOT_CONFIGURED',
  'E_RECIPIENT_PLAN_RESTRICTED', 'E_ACCOUNT_SUSPENDED',
])

/** What the consumer does with a failed send (§7.3). Unknown errors are retried. */
export function dispositionFor(code: string, attempts: number): Disposition {
  if (PERMANENT.has(code)) return { action: 'ack' }
  if (CONFIG.has(code)) return { action: 'ack', alert: true }
  if (code === 'E_DAILY_LIMIT_EXCEEDED') return { action: 'retry', delaySeconds: 60, alert: true }
  if (code === 'E_RATE_LIMIT_EXCEEDED') return { action: 'retry', delaySeconds: Math.min(30, 2 ** attempts) }
  // E_EMAIL_SENDING_NOT_READY, E_INTERNAL_SERVER_ERROR and anything unknown
  return { action: 'retry', delaySeconds: Math.min(60, 5 * 2 ** (attempts - 1)) }
}

// ─── Test sink (staging and local only) ──────────────────────────────────────────────────────────────────────────
// Addresses @sink.pocketfolio.test (a reserved, undeliverable TLD) are written to R2 instead of being sent, so an
// automated sign-in test can read its link and code. Only when the EMAIL_SINK_KEY secret exists, which production
// never has: there, such an address goes to Email Service and is rejected as undeliverable.

export const SINK_DOMAIN = 'sink.pocketfolio.test'
type SinkEnv = { BUCKET: R2Bucket; EMAIL_SINK_KEY?: string }

export const sinkEnabled = (env: SinkEnv) => (env.EMAIL_SINK_KEY ?? '').length >= 32
export const isSinkAddress = (to: string) => to.toLowerCase().endsWith(`@${SINK_DOMAIN}`)
export const sinkKeyValid = (env: SinkEnv, given: string | undefined) =>
  sinkEnabled(env) && !!given && safeEqual(given, env.EMAIL_SINK_KEY!)

const sinkObjectKey = async (env: SinkEnv, to: string) => `email-sink/${await hmacHex(env.EMAIL_SINK_KEY!, to.toLowerCase())}.json`

/** link and otp are empty for emails other than sign-in; `text` is the plain-text body. */
export type SinkedEmail = { kind: EmailJob['kind']; subject: string; link: string; otp: string; text: string; at: number }

export async function writeSink(env: SinkEnv, job: EmailJob, email: OutgoingEmail): Promise<void> {
  const login = job.kind === 'login' ? job : null
  const body: SinkedEmail = { kind: job.kind, subject: email.subject, link: login?.link ?? '', otp: login?.otp ?? '', text: email.text, at: Date.now() }
  await env.BUCKET.put(await sinkObjectKey(env, job.to), JSON.stringify(body))
}

/** The latest sinked email for an address, deleted on read. */
export async function takeSink(env: SinkEnv, to: string): Promise<SinkedEmail | null> {
  const key = await sinkObjectKey(env, to)
  const obj = await env.BUCKET.get(key)
  if (!obj) return null
  await env.BUCKET.delete(key)
  return obj.json<SinkedEmail>()
}

// ─── Templates ──────────────────────────────────────────────────────────────────────────────────────────────────
// Plain on purpose (§7.3): no portfolio data, only the link, the code, the expiry and "didn't ask? ignore it".

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

export function loginEmail(job: LoginEmailJob, minutes: number): OutgoingEmail {
  const subject = "Sign in to PocketFolio" // no code here: subjects show on lock screens and in previews
  const text = [
    'Sign in to PocketFolio',
    '',
    `Open this link to sign in: ${job.link}`,
    '',
    `Or enter this code: ${job.otp}`,
    '',
    `The link and the code work once and expire in ${minutes} minutes.`,
    "If you didn't ask to sign in, ignore this email. Nobody can sign in without it.",
  ].join('\n')
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F2F3F7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#12141C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#FFFFFF;border-radius:22px;padding:28px">
<tr><td style="font-size:15px;font-weight:600">PocketFolio</td></tr>
<tr><td style="padding-top:20px;font-size:20px;font-weight:600">Sign in to PocketFolio</td></tr>
<tr><td style="padding-top:20px"><a href="${esc(job.link)}" style="display:inline-block;background:#3D4DB7;color:#FFFFFF;text-decoration:none;font-weight:500;font-size:14px;padding:10px 18px;border-radius:10px">Sign in</a></td></tr>
<tr><td style="padding-top:24px;font-size:14px;color:#5B6176">Or enter this code in the app:</td></tr>
<tr><td style="padding-top:6px;font-size:28px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,Menlo,monospace">${esc(job.otp)}</td></tr>
<tr><td style="padding-top:24px;font-size:13px;color:#5B6176">The link and the code work once and expire in ${minutes} minutes. If you didn't ask to sign in, ignore this email. Nobody can sign in without it.</td></tr>
</table></td></tr></table></body></html>`
  return { to: job.to, subject, html, text }
}

/** The same card as the sign-in email, with paragraphs and an optional button. */
function plainHtml(title: string, paragraphs: string[], button?: { label: string; href: string }): string {
  const rows = paragraphs.map((p) => `<tr><td style="padding-top:16px;font-size:14px;line-height:1.5;color:#5B6176">${esc(p)}</td></tr>`).join('')
  const cta = button
    ? `<tr><td style="padding-top:20px"><a href="${esc(button.href)}" style="display:inline-block;background:#3D4DB7;color:#FFFFFF;text-decoration:none;font-weight:500;font-size:14px;padding:10px 18px;border-radius:10px">${esc(button.label)}</a></td></tr>`
    : ''
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F2F3F7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#12141C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#FFFFFF;border-radius:22px;padding:28px">
<tr><td style="font-size:15px;font-weight:600">PocketFolio</td></tr>
<tr><td style="padding-top:20px;font-size:20px;font-weight:600">${esc(title)}</td></tr>
${rows}${cta}
</table></td></tr></table></body></html>`
}

const SUPPORT = 'support@pocketfolio.in'

/** No portfolio data and no names: only what happened and who to ask (§7.3). */
export function accountDeletedEmail(job: DeletedEmailJob): OutgoingEmail {
  const subject = 'Your PocketFolio account was deleted'
  const paragraphs = [
    job.reason === 'inactive'
      ? "We deleted your PocketFolio account because nobody had signed in to it for 3 years, as our privacy policy says. We emailed you about it 2 days before."
      : 'Your PocketFolio account was deleted, as you asked.',
    'Your family members, statements and portfolio are gone for good, along with the key that protected them.',
    `You can sign up again at any time. Questions? Write to ${SUPPORT}.`,
  ]
  return { to: job.to, subject, text: [subject, '', ...paragraphs.flatMap((p) => [p, ''])].join('\n').trim(), html: plainHtml(subject, paragraphs) }
}

export function inactivityEmail(job: InactivityEmailJob, appUrl: string): OutgoingEmail {
  const subject = 'Your PocketFolio account will be deleted in 2 days'
  const when = new Date(`${job.erase_on}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const link = `${appUrl}/login`
  const paragraphs = [
    "Nobody has signed in to your PocketFolio account for 3 years. Our privacy policy says we then delete the account and everything in it.",
    `To keep it, sign in before ${when}. That's all you need to do. Otherwise we'll delete it on ${when}.`,
    `Questions? Write to ${SUPPORT}.`,
  ]
  const text = [subject, '', paragraphs[0]!, '', paragraphs[1]!, '', `Sign in: ${link}`, '', paragraphs[2]!].join('\n')
  return { to: job.to, subject, text, html: plainHtml(subject, paragraphs, { label: 'Sign in', href: link }) }
}

// ─── Consumer ───────────────────────────────────────────────────────────────────────────────────────────────────

type ConsumerEnv = SinkEnv & { EMAIL: SendEmail; EMAIL_FROM: string; APP_URL: string }
export const LOGIN_EXPIRY_MINUTES = 10

export async function handleEmailBatch(batch: MessageBatch<EmailJob>, env: ConsumerEnv, sender?: EmailSender) {
  const real = sender ?? new CloudflareEmailSender(env.EMAIL, { name: 'PocketFolio', email: env.EMAIL_FROM })
  let sent = 0
  for (const msg of batch.messages) {
    const job = msg.body
    const email = render(job, env)
    if (!email) {
      console.error('email_bad_message')
      msg.ack()
      continue
    }
    // The link and code expire after LOGIN_EXPIRY_MINUTES: a later delivery would only confuse.
    if (job.kind === 'login' && Date.now() - job.created_at > LOGIN_EXPIRY_MINUTES * 60_000) {
      console.error('email_expired', msg.attempts)
      msg.ack()
      continue
    }
    try {
      if (sinkEnabled(env) && isSinkAddress(job.to)) await writeSink(env, job, email)
      else await real.send(email)
      msg.ack()
      sent++
    } catch (e) {
      const code = e instanceof EmailSendError ? e.code : errorCode(e)
      const d = dispositionFor(code, msg.attempts)
      if (d.action === 'ack') {
        console.error(d.alert ? 'email_config_error' : 'email_dropped', code)
        msg.ack()
      } else {
        // E_DAILY_LIMIT_EXCEEDED is the alert signal (§7.3); M16 turns this log line into an alert.
        console.error(d.alert ? 'email_daily_limit' : 'email_retry', code, msg.attempts)
        msg.retry({ delaySeconds: d.delaySeconds })
      }
    }
  }
  if (sent) console.log('email_sent', sent)
}

function render(job: EmailJob | undefined, env: { APP_URL: string }): OutgoingEmail | null {
  if (typeof job?.to !== 'string') return null
  if (job.kind === 'login') return loginEmail(job, LOGIN_EXPIRY_MINUTES)
  if (job.kind === 'account_deleted') return accountDeletedEmail(job)
  if (job.kind === 'inactivity_notice') return inactivityEmail(job, env.APP_URL)
  return null
}
