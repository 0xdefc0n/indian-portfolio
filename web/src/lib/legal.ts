// Legal details and shared wording for the consent notice, the legal pages and the footer (plan §12).
//
// Owner, 2026-11-26: questions and complaints go to the support address (no named officer), and the lawyer review
// is deferred about 6 months. `placeholders: true` brings back the "draft" banner.

export const LEGAL = {
  placeholders: false,
  entity: "PocketFolio",
  /** Questions, complaints and data requests (DPDP Rule 9 contact). */
  contactEmail: "support@pocketfolio.in",
  /** We promise to answer within this (the law allows up to 90 days). */
  replyWithin: "30 days",
  /** The date the current texts took effect. */
  effective: "26 November 2026",
} as const

/** Must match NOTICE_VERSION in worker/src/lib/consent.ts. A new version asks every user to agree again. */
export const NOTICE_VERSION = "2026-11-26"

/** How long an unused account is kept before the 48-hour notice (worker/src/lib/cleanup.ts INACTIVE_MS). */
export const INACTIVE_PERIOD = "3 years"

/** What happens to an uploaded PDF (plan §12 "Uploaded PDFs"), the same on the consent screen and the privacy page. */
export const PDF_HANDLING =
  "We read your statement, keep only the figures we need, encrypted, and never keep the PDF. On a busy day it may wait its turn for a few minutes, encrypted, and it's always gone within 24 hours."

export const NOT_ADVICE = "Not investment advice. PocketFolio shows analytics only."
