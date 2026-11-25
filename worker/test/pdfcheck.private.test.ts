// Pre-check vs the Python engine on real statements (plan §16 "Pre-check and engine agree on every private PDF").
// The PDFs come from git-ignored folders via test/global-setup.ts and skip when absent (CI).
// Privacy (§0.1): assertions compare in memory and report pdf<N> + a boolean, never a value. Don't use toBe/toEqual
// on anything derived from a statement: vitest would print both sides on failure.
import { describe, expect, inject, it } from 'vitest'
import { precheckPdf } from '../src/lib/pdfcheck'

const pdfs = inject('privatePdfs')
const skipReason = inject('privatePdfsSkipReason')

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')

describe.skipIf(!pdfs.length)(`pre-check on private statements (${pdfs.length || skipReason})`, () => {
  it.each(pdfs.map((p) => [p.id, p] as const))('%s: agrees with the engine on type, password and PAN', async (id, p) => {
    const engineOk = p.engine.ok
    expect(engineOk, `${id}: engine failed to parse (code ${p.engine.code})`).toBe(true)

    const r = await precheckPdf(fromBase64(p.base64), p.candidates)
    expect(r.ok, `${id}: pre-check failed with ${r.code}`).toBe(true)
    if (!r.ok) return
    const sameKind = r.kind === p.engine.kind
    expect(sameKind, `${id}: type differs from the engine`).toBe(true)
    const sameIndex = (r.passwordIndex ?? 0) === p.engine.password_index // engine reports 0 for an unencrypted file
    expect(sameIndex, `${id}: a different password opened it`).toBe(true)
    const panFound = r.panStatus === 'found'
    expect(panFound, `${id}: holder PAN ${r.panStatus}`).toBe(true)
    const samePan = r.pan !== null && (await sha256(r.pan)) === p.engine.pan_sha256
    expect(samePan, `${id}: PAN differs from the engine's parsed PAN`).toBe(true)
  })

  it.each(pdfs.map((p) => [p.id, p] as const))('%s: skips wrong candidates and rejects when all are wrong', async (id, p) => {
    const bytes = fromBase64(p.base64)
    const r = await precheckPdf(bytes, ['wrong-password-1', ...p.candidates])
    const encrypted = r.ok && r.passwordIndex !== null
    if (r.ok && r.passwordIndex === null) return // unencrypted: nothing to try
    const shifted = r.ok && r.passwordIndex === (p.engine.password_index + 1)
    expect(shifted, `${id}: wrong first candidate not skipped`).toBe(true)
    expect(encrypted).toBe(true)
    const none = await precheckPdf(bytes, ['wrong-password-1', 'wrong-password-2'])
    const rejected = none.code === 'password_required'
    expect(rejected, `${id}: wrong passwords not rejected (${none.code})`).toBe(true)
  })
})
