// Legal details for the privacy notice, the legal pages and the footer (plan §12).
//
// ⚠️ PLACEHOLDERS (M14): the owner still has to give the legal entity name, the grievance officer's name and email,
// and the jurisdiction (plan §19). Until then the bracketed values below show on the pages, with a "draft" banner,
// and a lawyer reviews the text before launch (M17). Replace the values and set `placeholders: false`.

export const LEGAL = {
  placeholders: true,
  entity: "[Legal entity name]",
  grievanceOfficer: "[Grievance officer name]",
  grievanceEmail: "[grievance@pocketfolio.in]",
  jurisdiction: "[City], India",
  supportEmail: "support@pocketfolio.in",
  /** The date the current texts took effect. */
  effective: "26 November 2026",
} as const

/** Must match NOTICE_VERSION in worker/src/lib/consent.ts. A new version asks every user to agree again. */
export const NOTICE_VERSION = "2026-11-26"

/** How long an unused account is kept before the 48-hour notice (worker/src/lib/cleanup.ts INACTIVE_MS). */
export const INACTIVE_PERIOD = "3 years"

/** The PDF-handling sentence (plan §12 "Uploaded PDFs"), the same on the consent screen and the privacy page. */
export const PDF_HANDLING =
  "We read your statement and keep only the parsed data, encrypted. Usually the PDF is never stored. When many people upload at once, it's held encrypted until it's processed, usually for minutes, and always deleted within 24 hours."

export const NOT_ADVICE = "Not investment advice. PocketFolio shows analytics only."
