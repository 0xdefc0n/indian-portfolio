// /api/statements (plan §9.2, §10.1). Upload takes the file and an optional password only (D19): any `pan` or
// `member_id` field is ignored, because the member comes from the statement itself.
// A file that isn't a PDF is a broker file (M34, plan §21.13): a holdings statement or tradebook, CSV or Excel. Those
// carry no PAN, so `member_id` or `new_member_name` say whose it is when the server asks (422 needs_member).
import { Hono } from 'hono'
import { auditStatement } from '../lib/audit'
import { isUuid } from '../lib/blob'
import { ApiError, notFound } from '../lib/errors'
import { LIMITS } from '../lib/limits'
import { deleteStatement, isPdf, uploadStatement } from '../lib/statements'
import { uploadBrokerFile } from '../lib/broker-files'
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
  if (!isPdf(bytes)) {
    const result = await uploadBrokerFile(
      tenant(c),
      { bytes, password: typeof password === 'string' ? password : null, memberId: form.get('member_id'), newMemberName: form.get('new_member_name') },
      { holdings: await auditStatement(c, 'broker_holdings_added'), tradebook: await auditStatement(c, 'tradebook_added') },
    )
    return c.json(result, 201)
  }

  const result = await uploadStatement(
    tenant(c),
    { bytes, password: typeof password === 'string' ? password : null },
    await auditStatement(c, 'statement_added'),
  )
  // 201: parsed and stored now. 202: every check passed and the PDF is parked for the queue (§10.1 D7).
  if ('queued' in result) return c.json({ job: result.queued }, 202)
  return c.json(result.added, 201)
})

statementRoutes.delete('/statements/:id', signedIn, async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) throw notFound()
  const ok = await deleteStatement(tenant(c), id, await auditStatement(c, 'statement_deleted', { onlyIfChanged: true }))
  if (!ok) throw notFound()
  return c.json({ ok: true })
})
