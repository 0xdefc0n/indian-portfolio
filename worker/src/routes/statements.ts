// /api/statements (plan §9.2, §10.1). Upload takes the file and an optional password only (D19): any `pan` or
// `member_id` field is ignored, because the member comes from the statement itself.
import { Hono } from 'hono'
import { auditStatement } from '../lib/audit'
import { isUuid } from '../lib/blob'
import { ApiError, notFound } from '../lib/errors'
import { LIMITS } from '../lib/limits'
import { deleteStatement, uploadStatement } from '../lib/statements'
import { tenant } from '../lib/tenant'
import { requireSession } from '../middleware/session'
import type { AppBindings } from '../types'

export const statementRoutes = new Hono<AppBindings>()
const signedIn = requireSession() // per route, so unknown paths stay JSON 404s

/** Room for the multipart boundaries and the password field around a 10 MB file. */
const MULTIPART_SLACK = 64 * 1024

statementRoutes.post('/statements', signedIn, async (c) => {
  // Refuse before buffering anything: the pre-check holds the whole upload in memory (M3 note).
  const declared = Number(c.req.header('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > LIMITS.uploadBytes + MULTIPART_SLACK) throw new ApiError(413, 'file_too_large')
  if (!/^multipart\/form-data/i.test(c.req.header('content-type') ?? '')) throw new ApiError(400, 'bad_request')

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) throw new ApiError(400, 'bad_request')
  if (file.size > LIMITS.uploadBytes) throw new ApiError(413, 'file_too_large')
  const password = form.get('password')
  const bytes = new Uint8Array(await file.arrayBuffer())

  const added = await uploadStatement(
    tenant(c),
    { bytes, password: typeof password === 'string' ? password : null },
    await auditStatement(c, 'statement_added'),
  )
  return c.json(added, 201)
})

statementRoutes.delete('/statements/:id', signedIn, async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) throw notFound()
  const ok = await deleteStatement(tenant(c), id, await auditStatement(c, 'statement_deleted', { onlyIfChanged: true }))
  if (!ok) throw notFound()
  return c.json({ ok: true })
})
