// Disposable (throwaway) email domains are refused for new accounts (plan §21.7, D20, M22).
// The list is the CC0 disposable-email-domains/disposable-email-domains list, bundled at build time through the
// disposable-email-domains-js package (no dependencies, ~10.5k domains, ~200 KB). It's refreshed whenever
// dependencies are updated. Subdomains of a listed domain count as listed (the package checks every parent domain).
import { isDisposableEmailDomain } from 'disposable-email-domains-js'

/** True when the address's domain, or any parent domain of it, is on the bundled list. Case-insensitive. */
export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf('@')
  if (at < 1) return false
  return isDisposableEmailDomain(email.slice(at + 1))
}

/**
 * Whether a sign-in email may be sent to this address: anything not on the list, or an address that already has a
 * user (made before the list caught its domain, or through Google, which isn't checked). Only a listed domain costs
 * a D1 read. `email` is already trimmed and lower-cased, as Better Auth stores it.
 */
export async function allowedForLogin(db: D1Database, email: string): Promise<boolean> {
  if (!isDisposableEmail(email)) return true
  const row = await db.prepare('SELECT 1 FROM "user" WHERE email = ?').bind(email).first()
  return row !== null
}
