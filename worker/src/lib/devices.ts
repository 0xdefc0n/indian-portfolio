// QR device login and Settings → Devices (plan §7.4, D2). One account, many devices: a linked device is one more
// session for the approver's own user. No PII in logs; the user agent is shown to its own account only, as a short
// label ("Chrome · macOS").

/** Better Auth's device plugin wants a client id; the web app is the only client (plan §7.4). */
export const QR_CLIENT_ID = 'web-qr'
/** A code lasts 5 minutes and is single use (plan §7.4). */
export const QR_EXPIRES_S = 5 * 60
export const QR_INTERVAL_S = 5
/** Device-code creation per IP (plan §7.4). */
export const QR_CODES_PER_IP = { window: 3600, max: 10 }
/** Approval-page lookups per user: enough for real use, far too few to guess someone else's 8-character code. */
export const LINK_LOOKUPS_PER_USER = { window: 600, max: 30 }
/** A QR-linked device shows "New" in Settings → Devices, and the notice is shown, for this long (plan §7.4). */
export const NEW_DEVICE_MS = 7 * 86_400_000
/** device_code_meta rows and finished deviceCode rows are deleted by cleanup after this. */
export const DEVICE_CODE_KEEP_MS = 3600_000

export type Place = { city: string | null; country: string | null }

/** Cloudflare's approximate place for the request (request.cf, which a client can't set; not a header). */
export function requestPlace(req: Request | undefined | null): Place {
  const cf = (req as { cf?: { city?: unknown; country?: unknown } } | undefined | null)?.cf
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null)
  return { city: str(cf?.city, 80), country: str(cf?.country, 2) }
}

/** "Chrome · macOS" from a user agent. Order matters: Edge and Opera say "Chrome", Chrome says "Safari". */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device'
  const browser =
    /Edg(A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : null
  const os =
    /iPhone|iPod/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : null
  const parts = [browser, os].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Unknown device'
}

/** The plugin's user-code alphabet has no 0/O/1/I; people may type it with a dash or in lower case. */
export const normalizeUserCode = (code: string) => code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16)

/** "ABCD-EFGH" for display. */
export const formatUserCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code)

/** Better Auth stores dates as ISO text (older rows may be numbers). */
export function dateMs(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

export type LinkedNotice = { label: string; city: string | null; country: string | null }

/**
 * The "New device linked" notice, as a subquery of /api/me's one household read (the D1 budget stays at one query).
 * Devices linked by QR after this session started, or after its last notice, within NEW_DEVICE_MS, other than itself.
 * Binds: ?2 user id, ?3 session id, ?4 the lower bound (max of the session start and now − NEW_DEVICE_MS).
 */
export const LINKED_NOTICE_SQL = `(
  SELECT json_group_array(json_object('ua', s."userAgent", 'city', s.city, 'country', s.country))
  FROM session s
  WHERE s."userId" = ?2 AND s.id <> ?3 AND s."linkedAt" > ?4
    AND s."linkedAt" > COALESCE((SELECT "noticeAt" FROM session WHERE id = ?3), 0)
)`

export function parseLinkedNotice(raw: unknown): LinkedNotice[] {
  if (typeof raw !== 'string') return []
  try {
    const rows = JSON.parse(raw) as { ua: string | null; city: string | null; country: string | null }[]
    return rows.map((r) => ({ label: deviceLabel(r.ua), city: r.city, country: r.country }))
  } catch {
    return []
  }
}
