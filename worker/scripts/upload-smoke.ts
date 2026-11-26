// Upload smoke test on staging with one private statement (M7 "Done when", plan §16):
//   node scripts/upload-smoke.ts https://staging.pocketfolio.in [path/to/statement.pdf]
// Signs in a synthetic @sink.pocketfolio.test user, uploads the PDF (first with no password, then with the candidates
// from the file name and TEST_PDF_PASSWORD), and checks R2 through the Cloudflare API: exactly one statement blob
// under the household, nothing under its tmp/, and a raw read shows no plaintext. Then it deletes the statement and
// checks the blob is gone, so no real data stays on staging (pass --keep to leave it).
// Needs STAGING_EMAIL_SINK_KEY, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .dev.vars.
// Privacy (§0.1): prints ok/FAIL lines, status codes, error codes, counts and timings only. Never the PAN, the
// password, the file name or anything from the statement.
import { readFileSync } from 'node:fs'
import { candidatePasswords, devVar, privatePdfPaths } from '../test/helpers/private-pdfs.ts'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const keep = process.argv.includes('--keep')
const base = (args[0] ?? '').replace(/\/$/, '')
if (!/^https:\/\/[^/]*staging[^/]*$/.test(base)) throw new Error('staging only: pass the staging base URL')
const pdfPath = args[1] ?? privatePdfPaths()[0]
if (!pdfPath) throw new Error('no private statement found (data/ or engine/tests/private/)')
const sinkKey = devVar('STAGING_EMAIL_SINK_KEY')
const token = devVar('CLOUDFLARE_API_TOKEN')
const account = devVar('CLOUDFLARE_ACCOUNT_ID')
if (!sinkKey || !token || !account) throw new Error('STAGING_EMAIL_SINK_KEY, CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID missing from .dev.vars')
const BUCKET = 'pocketfolio-data-staging'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (!ok) failed++
  return ok
}

const cookies = new Map<string, string>()
async function api(path: string, init: { method?: string; body?: unknown; form?: FormData; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { origin: base, ...init.headers }
  if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  let body: BodyInit | undefined
  if (init.form) body = init.form
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  const r = await fetch(base + path, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, redirect: 'manual' })
  for (const line of r.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const i = pair!.indexOf('=')
    const v = pair!.slice(i + 1)
    if (/max-age=0/i.test(line) || !v) cookies.delete(pair!.slice(0, i))
    else cookies.set(pair!.slice(0, i), v)
  }
  return r
}

// R2 through the Cloudflare API (wrangler has no object list).
const r2 = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects`
const auth = { authorization: `Bearer ${token}` }
async function r2List(prefix: string): Promise<string[]> {
  const r = await fetch(`${r2}?prefix=${encodeURIComponent(prefix)}&per_page=100`, { headers: auth })
  const d = (await r.json()) as { success: boolean; result?: { key: string }[] }
  if (!d.success) throw new Error(`R2 list failed (${r.status})`)
  return (d.result ?? []).map((o) => o.key)
}
async function r2Get(key: string): Promise<Uint8Array | null> {
  const r = await fetch(`${r2}/${key.split('/').map(encodeURIComponent).join('/')}`, { headers: auth })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`R2 get failed (${r.status})`)
  return new Uint8Array(await r.arrayBuffer())
}

// 1. Sign in (synthetic sink address).
const email = `upload-smoke-${crypto.randomUUID().slice(0, 8)}@sink.pocketfolio.test`
const sink = { 'x-email-sink-key': sinkKey }
check('POST /api/login/email', (await api('/api/login/email', { body: { email }, headers: sink })).status === 200)
let otp = ''
for (let i = 0; i < 60 && !otp; i++) {
  const s = await api(`/api/test/email-sink?to=${encodeURIComponent(email)}`, { headers: sink })
  if (s.status === 200) otp = ((await s.json()) as { otp: string }).otp
  else await new Promise((ok) => setTimeout(ok, 500))
}
check('sign-in email arrived', !!otp)
check('signed in with the code', (await api('/api/auth/sign-in/email-otp', { body: { email, otp } })).status === 200)
const me = (await (await api('/api/me')).json()) as { household?: { id: string } }
const hid = me.household?.id ?? ''
if (!check('GET /api/me has a household', !!hid)) process.exit(1)

// 2. Upload: no password first (D19), then each candidate as the typed password.
const bytes = readFileSync(pdfPath)
type Added = { code?: string; typed?: boolean; statement?: { id: string; kind: string; holdings_count: number }; member?: { created: boolean } }
async function upload(password: string | null) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'statement.pdf')
  if (password) form.append('password', password)
  const t0 = Date.now()
  const r = await api('/api/statements', { form })
  return { status: r.status, body: (await r.json()) as Added, ms: Date.now() - t0 }
}
let res = await upload(null)
console.log(`     upload with no password: ${res.status}${res.body.code ? ` ${res.body.code}` : ''} in ${res.ms} ms`)
for (const [i, pw] of candidatePasswords(pdfPath).entries()) {
  if (res.status !== 422 || res.body.code !== 'password_required') break
  res = await upload(pw)
  console.log(`     upload with candidate ${i}: ${res.status}${res.body.code ? ` ${res.body.code}` : ''} in ${res.ms} ms`)
}
if (!check('statement stored (201)', res.status === 201, `${res.status} ${res.body.code ?? ''}`)) process.exit(1)
const st = res.body.statement!
console.log(`     ${st.kind}, ${st.holdings_count} holdings, new member: ${res.body.member?.created}`)

// 3. R2: one sealed statement blob, nothing in tmp/, no plaintext.
const keys = await r2List(`h/${hid}/`)
const key = `h/${hid}/statements/${st.id}.bin`
check('exactly one blob under h/{household}/, the statement', keys.length === 1 && keys[0] === key, `${keys.length} objects`)
check('nothing under tmp/{household}/', (await r2List(`tmp/${hid}/`)).length === 0)
const raw = await r2Get(key)
check('blob readable through the API', !!raw)
if (raw) {
  const text = Buffer.from(raw).toString('latin1')
  const secrets = [...candidatePasswords(pdfPath).filter(Boolean), '%PDF-', '"isin"', 'holder_name', '"holdings"']
  check('sealed blob header (format 1, gzip flag)', raw[0] === 0x01 && raw[2] === 0x01)
  check('raw read shows no plaintext (no PDF, PAN, password or JSON keys)', !secrets.some((s) => text.includes(s)))
  console.log(`     blob ${raw.length} bytes`)
}
check('duplicate refused (409)', (await upload(null)).status === 409)

// 4. Clean up: delete the statement and check the blob is gone.
if (!keep) {
  check('DELETE /api/statements/:id', (await api(`/api/statements/${st.id}`, { method: 'DELETE' })).status === 200)
  check('blob deleted from R2', (await r2List(`h/${hid}/`)).length === 0)
}
await api('/api/auth/sign-out', { body: {} })
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
