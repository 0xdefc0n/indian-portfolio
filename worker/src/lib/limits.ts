// Fair-use limits (plan §11, D7). One place, so Settings can show them later.
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
} as const

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
