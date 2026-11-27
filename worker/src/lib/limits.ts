// Fair-use limits (plan §11, D7). One place, so Settings can show them later.
import { MAX_ASSETS } from './manual-assets'
import type { QuotaSpec } from './quota'

export const LIMITS = {
  uploadBytes: 10 * 1024 * 1024,
  membersPerHousehold: 10,
  statementsPerMember: 24,
  uploadsPerDay: 20,
  uploadsPerMonth: 100,
  failedParsesPerHour: 10,
  openJobsPerHousehold: 10,
  exportsPerDay: 3, // plan §9.2: GET /api/account/export
  metricEventsPerDay: 30, // plan §13A.6: POST /api/metrics (a normal day sends a handful)
  assetsPerHousehold: MAX_ASSETS, // plan §21.12: FD, PPF, EPF entered by hand (M19)
  assetWritesPerDay: 30, // adds and edits; deleting is never limited
  tradebookBytes: 5 * 1024 * 1024, // plan §21.6: a broker tradebook (CSV or Excel)
  tradebooksPerMember: 24,
  brokerHoldingsPerMember: 12, // plan §21.13 (M34): one per broker account; a newer file from the account replaces it
  stockCostsPerHousehold: 500, // manual average buy prices (M21)
} as const

/** Product counters: caps what one account can add to the shared daily totals. */
export const metricQuota = (userId: string): QuotaSpec => ({ subject: `user:${userId}`, metric: 'metric', period: 'day', limit: LIMITS.metricEventsPerDay })

/** Data exports (DPDP access right): a few a day is plenty, and each one decrypts every statement. */
export const exportQuota = (userId: string): QuotaSpec => ({ subject: `user:${userId}`, metric: 'export', period: 'day', limit: LIMITS.exportsPerDay })

/** The two upload counters, taken together when a statement is stored. */
export const uploadQuota = (userId: string): QuotaSpec[] => [
  { subject: `user:${userId}`, metric: 'upload', period: 'day', limit: LIMITS.uploadsPerDay },
  { subject: `user:${userId}`, metric: 'upload', period: 'month', limit: LIMITS.uploadsPerMonth },
]

/** Uploads that failed on something the user did (wrong password, not a statement, unreadable file). */
export const failQuota = (userId: string): QuotaSpec => ({
  subject: `user:${userId}`,
  metric: 'parse_fail',
  period: 'hour',
  limit: LIMITS.failedParsesPerHour,
})

/** Manual asset adds and edits (M19), per household: a normal day needs a handful. */
export const assetWriteQuota = (householdId: string): QuotaSpec => ({
  subject: `household:${householdId}`,
  metric: 'asset_write',
  period: 'day',
  limit: LIMITS.assetWritesPerDay,
})
