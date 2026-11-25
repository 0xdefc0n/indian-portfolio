// Synthetic PDFs for the pre-check tests (plan §16 "Pre-check"). Fake data only: no real statement is ever a fixture.
// Writes a minimal PDF 1.4 with one Helvetica text stream per page, optionally encrypted with the standard security
// handler (V2 / R3, RC4 128-bit), which is what CDSL / CAMS / KFintech statements use. Runs in workerd and in Node.
import { createHash } from 'node:crypto'

export type FixturePage = string[] // one text line per entry; a line may hold several space-separated items

export type FixtureOptions = {
  userPassword?: string // encrypt when set
  ownerPassword?: string
  padBytes?: number // add an unreferenced-by-pages binary stream of this size (to reach a target file size)
  linesPerPage?: number // repeat filler text to grow each content stream
}

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00,
  0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])
const PERMS = -4

const enc = new TextEncoder()
const md5 = (...parts: Uint8Array[]) => {
  const h = createHash('md5')
  for (const p of parts) h.update(p)
  return new Uint8Array(h.digest())
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255
    ;[s[i], s[j]] = [s[j]!, s[i]!]
  }
  const out = new Uint8Array(data.length)
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255
    j = (j + s[i]!) & 255
    ;[s[i], s[j]] = [s[j]!, s[i]!]
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!
  }
  return out
}

const padPassword = (pw: string) => {
  const out = new Uint8Array(32)
  const b = enc.encode(pw).slice(0, 32)
  out.set(b)
  out.set(PAD.subarray(0, 32 - b.length), b.length)
  return out
}

const le32 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255])

/** PDF 1.7 §7.6.3, algorithms 2, 3 and 5 for R3 with a 16-byte key. */
function standardSecurity(user: string, owner: string, id: Uint8Array) {
  let ok = md5(padPassword(owner))
  for (let i = 0; i < 50; i++) ok = md5(ok)
  let O = rc4(ok, padPassword(user))
  for (let i = 1; i <= 19; i++) O = rc4(ok.map((b) => b ^ i), O)

  let key = md5(padPassword(user), O, le32(PERMS), id)
  for (let i = 0; i < 50; i++) key = md5(key)

  let U = rc4(key, md5(PAD, id))
  for (let i = 1; i <= 19; i++) U = rc4(key.map((b) => b ^ i), U)
  const U32 = new Uint8Array(32)
  U32.set(U)
  return { O, U: U32, key }
}

const objectKey = (key: Uint8Array, num: number) =>
  md5(key, Uint8Array.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 16)

const escapeText = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c)

export function makePdf(pages: FixturePage[], opts: FixtureOptions = {}): Uint8Array {
  const id = md5(enc.encode(`fixture-${pages.length}-${opts.userPassword ?? ''}`))
  const sec = opts.userPassword !== undefined ? standardSecurity(opts.userPassword, opts.ownerPassword ?? 'owner', id) : null

  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b
    chunks.push(bytes)
    size += bytes.length
  }
  const obj = (num: number, body: string) => {
    offsets[num] = size
    push(`${num} 0 obj\n${body}\nendobj\n`)
  }
  const stream = (num: number, data: Uint8Array, extra = '') => {
    const bytes = sec ? rc4(objectKey(sec.key, num), data) : data
    offsets[num] = size
    push(`${num} 0 obj\n<< /Length ${bytes.length}${extra} >>\nstream\n`)
    push(bytes)
    push('\nendstream\nendobj\n')
  }

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const firstPage = 4
  const kids = pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')

  const filler = 'Lorem ipsum dolor sit amet 0123456789 consectetur adipiscing elit sed do eiusmod tempor'
  pages.forEach((lines, i) => {
    const pageNum = firstPage + i * 2
    const all = [...lines, ...Array.from({ length: opts.linesPerPage ?? 0 }, () => filler)]
    const ops = ['BT', '/F1 9 Tf', '11 TL', '36 806 Td']
    // Each space-separated word is its own Tj, like real statements, so the text arrives in several items.
    for (const line of all) {
      for (const word of line.split(' ')) ops.push(`(${escapeText(word)} ) Tj`)
      ops.push('T*')
    }
    ops.push('ET')
    obj(pageNum, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNum + 1} 0 R >>`)
    stream(pageNum + 1, enc.encode(ops.join('\n')))
  })

  let next = firstPage + pages.length * 2
  if (opts.padBytes) {
    const pad = new Uint8Array(opts.padBytes)
    for (let i = 0; i < pad.length; i++) pad[i] = (i * 2654435761) >>> 24 // incompressible-looking noise
    stream(next++, pad)
  }
  let encryptRef = ''
  if (sec) {
    const encNum = next++
    obj(encNum, `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${PERMS} /O <${hex(sec.O)}> /U <${hex(sec.U)}> >>`)
    encryptRef = ` /Encrypt ${encNum} 0 R`
  }

  const xref = size
  const count = next
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(table)
  push(`trailer\n<< /Size ${count} /Root 1 0 R /ID [<${hex(id)}> <${hex(id)}>]${encryptRef} >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

// Fake statement pages. PANs are synthetic (4th letter P = individual, T = trust).
export const FAKE_PAN = 'ABCPD1234F'
export const FAKE_PAN_2 = 'ZYXPW9876K'
export const FAKE_TRUST_PAN = 'AAATK1234Q'

export const cdslPages = (pan = FAKE_PAN): FixturePage[] => [
  ['CENTRAL DEPOSITORY SERVICES (INDIA) LIMITED', 'Consolidated Account Statement', `CAS ID : 000000000`],
  ['TEST HOLDER', `PAN : ${pan}`, 'Statement for the period 01-10-2026 to 31-10-2026'],
  ['Mutual Fund Units Held in Demat Form'],
]

export const kfinPages = (pan = FAKE_PAN): FixturePage[] => [
  ['Consolidated Account Statement', 'KFin Technologies Limited', 'Email Id: test@example.invalid'],
  [`Example Mutual Fund Trust PAN: ${FAKE_TRUST_PAN}`, `Folio No: 0000 PAN: ${pan}`, 'Test Holder'],
]
