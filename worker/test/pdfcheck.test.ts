// Pre-check on synthetic PDFs (plan §10.1 A5, §16 "Pre-check"). Runs inside workerd, so it also proves pdf.js loads
// in a Worker isolate. Real statements are covered in pdfcheck.private.test.ts (booleans only).
import { describe, expect, it } from 'vitest'
import { detectKind, findHolderPans, MAX_PAGES, precheckPdf } from '../src/lib/pdfcheck'
import { cdslPages, FAKE_PAN, FAKE_PAN_2, FAKE_TRUST_PAN, kfinPages, makePdf } from './helpers/pdf-fixture'

describe('precheckPdf', () => {
  it('opens an unencrypted CDSL statement without a password and finds the PAN', async () => {
    const r = await precheckPdf(makePdf(cdslPages()), [])
    expect(r).toEqual({ ok: true, code: 'ok', kind: 'CDSL', passwordIndex: null, pan: FAKE_PAN, panStatus: 'found', pages: 3 })
  })

  it('tries candidates in order and reports the one that worked', async () => {
    const pdf = makePdf(kfinPages(), { userPassword: 'kfin-secret' })
    const r = await precheckPdf(pdf, ['typed-wrong', 'ABCDE0000Z', 'kfin-secret', 'never-tried'])
    expect(r).toMatchObject({ ok: true, kind: 'RTA', passwordIndex: 2 })
  })

  it('opens with the first candidate when it is the PAN (usual CDSL password)', async () => {
    const r = await precheckPdf(makePdf(cdslPages(), { userPassword: FAKE_PAN }), [FAKE_PAN, 'other'])
    expect(r).toMatchObject({ ok: true, kind: 'CDSL', passwordIndex: 0, pan: FAKE_PAN })
  })

  it('returns password_required when every candidate is wrong, or there are none', async () => {
    const pdf = makePdf(cdslPages(), { userPassword: 'right' })
    expect(await precheckPdf(pdf, ['wrong-1', 'wrong-2'])).toEqual({ ok: false, code: 'password_required', pages: null })
    expect(await precheckPdf(pdf, [])).toEqual({ ok: false, code: 'password_required', pages: null })
  })

  it('leaves the caller’s bytes intact (they are sent on to the engine)', async () => {
    const pdf = makePdf(cdslPages(), { userPassword: 'right' })
    const before = pdf.byteLength
    await precheckPdf(pdf, ['right'])
    expect(pdf.byteLength).toBe(before)
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-')
  })

  it('skips the trust PAN on a KFintech statement', async () => {
    const r = await precheckPdf(makePdf(kfinPages()), [])
    expect(r).toMatchObject({ ok: true, pan: FAKE_PAN, panStatus: 'found' })
  })

  it('finds a PAN split by whitespace in the text', async () => {
    const pages = [['Consolidated Account Statement CAMS', 'PAN : ABC PD 1234 F']]
    expect(await precheckPdf(makePdf(pages), [])).toMatchObject({ ok: true, pan: FAKE_PAN, panStatus: 'found' })
  })

  it('reads the PAN from pages 1–3 only', async () => {
    const page3 = [['CAS ID 1 CENTRAL DEPOSITORY'], ['…'], [`PAN: ${FAKE_PAN}`]]
    const page4 = [['CAS ID 1 CENTRAL DEPOSITORY'], ['…'], ['…'], [`PAN: ${FAKE_PAN}`]]
    expect(await precheckPdf(makePdf(page3), [])).toMatchObject({ pan: FAKE_PAN, panStatus: 'found' })
    expect(await precheckPdf(makePdf(page4), [])).toMatchObject({ ok: true, pan: null, panStatus: 'none', pages: 4 })
  })

  it('reports two different individual PANs as ambiguous (the parse decides)', async () => {
    const pages = [['KFINTECH', `PAN: ${FAKE_PAN}`, `PAN: ${FAKE_PAN_2}`]]
    expect(await precheckPdf(makePdf(pages), [])).toMatchObject({ ok: true, kind: 'RTA', pan: null, panStatus: 'ambiguous' })
  })

  it('detects the type from pages 1–2 only', async () => {
    const pages = [['Hello'], ['World'], ['CENTRAL DEPOSITORY']]
    expect(await precheckPdf(makePdf(pages), [])).toEqual({ ok: false, code: 'unrecognised', pages: 3 })
  })

  it('rejects a PDF that is not a CAS, and bytes that are not a PDF', async () => {
    expect(await precheckPdf(makePdf([['An electricity bill']]), [])).toEqual({ ok: false, code: 'unrecognised', pages: 1 })
    const junk = new TextEncoder().encode('%PDF-1.4\nthis is not really a pdf')
    expect(await precheckPdf(junk, [])).toEqual({ ok: false, code: 'unrecognised', pages: null })
  })

  it(`rejects more than ${MAX_PAGES} pages`, async () => {
    const pages = [cdslPages()[0]!, ...Array.from({ length: MAX_PAGES }, () => ['page'])]
    expect(await precheckPdf(makePdf(pages), [])).toEqual({ ok: false, code: 'too_large', pages: MAX_PAGES + 1 })
    expect(await precheckPdf(makePdf(pages.slice(0, MAX_PAGES)), [])).toMatchObject({ ok: true, pages: MAX_PAGES })
  })

  it('handles a 10 MB, 300-page encrypted PDF', { timeout: 60_000 }, async () => {
    const pages = [...cdslPages(), ...Array.from({ length: MAX_PAGES - 3 }, () => ['page'])]
    const pdf = makePdf(pages, { userPassword: FAKE_PAN, linesPerPage: 60, padBytes: 9 * 1024 * 1024 })
    expect(pdf.byteLength).toBeGreaterThan(10 * 1000 * 1000)
    const r = await precheckPdf(pdf, ['wrong', FAKE_PAN])
    expect(r).toMatchObject({ ok: true, kind: 'CDSL', passwordIndex: 1, pan: FAKE_PAN, pages: MAX_PAGES })
  })
})

describe('text rules', () => {
  it('detectKind mirrors the engine keywords', () => {
    expect(detectKind('mutual fund units held in demat form')).toBe('CDSL')
    expect(detectKind('Computer Age Management Services')).toBe('RTA')
    expect(detectKind('bank statement')).toBeNull()
  })

  it('findHolderPans takes labelled individual PANs only', () => {
    const text = `PAN No. : ${FAKE_PAN} Trust PAN-${FAKE_TRUST_PAN} unlabelled ${FAKE_PAN_2} COMPANY PAN: AAACX1111X`
    expect([...findHolderPans(text)]).toEqual([FAKE_PAN])
  })
})
