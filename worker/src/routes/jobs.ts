// /api/jobs (plan §9.2): queued uploads. Every query binds the session's household (§9.1); a job of another
// household is a 404. No PDF data, member name or PAN is in a job; a finished one points at its statement.
import { Hono } from 'hono'
import { notFound } from '../lib/errors'
import { cancelJob, getJob, listJobs, pollAfter } from '../lib/jobs'
import { tenant } from '../lib/tenant'
import { requireSession } from '../middleware/session'
import type { AppBindings } from '../types'

export const jobRoutes = new Hono<AppBindings>()
const signedIn = requireSession()

jobRoutes.get('/jobs', signedIn, async (c) => c.json({ jobs: await listJobs(tenant(c)) }))

jobRoutes.get('/jobs/:id', signedIn, async (c) => {
  const job = await getJob(tenant(c), c.req.param('id'))
  const after = pollAfter(job)
  if (after !== null) c.header('Retry-After', String(after))
  return c.json({ job })
})

jobRoutes.delete('/jobs/:id', signedIn, async (c) => {
  if (!(await cancelJob(tenant(c), c.req.param('id')))) throw notFound()
  return c.json({ ok: true })
})

