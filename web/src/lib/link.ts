// QR device login helpers (plan §7.4).

/** The user code from a scanned QR: only our own /link URL counts, never another site's (no open redirect via QR). */
export function codeFromScan(text: string, origin: string): string | null {
  try {
    const url = new URL(text)
    if (url.origin !== origin || url.pathname !== "/link") return null
    const code = url.searchParams.get("user_code")
    return code && /^[A-Za-z0-9-]{4,16}$/.test(code) ? code : null
  } catch {
    return null
  }
}
