// Turnstile check for the "email me a link" form (plan §7.1). The Worker verifies the token before Better Auth runs.
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  if (!token || token.length > 2048) return false
  const body = new FormData()
  body.append('secret', secret)
  body.append('response', token)
  if (ip) body.append('remoteip', ip)
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body })
    if (!res.ok) return false
    const out = await res.json<{ success?: boolean }>()
    return out.success === true
  } catch {
    return false
  }
}
