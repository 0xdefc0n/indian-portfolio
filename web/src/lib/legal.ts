// Legal details for the privacy notice, the legal pages and the footer (plan §12).
//
// Filled in by the owner on 2026-11-26. ⚠️ The grievance officer's name is still to come. The lawyer review is
// deferred about 6 months (owner, 2026-11-26). `placeholders: true` brings back the "draft" banner.

export const LEGAL = {
  placeholders: false,
  entity: "PocketFolio",
  grievanceOfficer: "[Grievance officer name]",
  grievanceEmail: "support@pocketfolio.in",
  jurisdiction: "Gujarat, India",
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
