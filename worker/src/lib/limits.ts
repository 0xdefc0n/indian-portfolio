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
} as const

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
