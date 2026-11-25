// Upload pre-check (plan §10.1 A5, D19): open the PDF with candidate passwords, detect the statement type from
// pages 1–2, find the holder's PAN on pages 1–3 and count pages. Everything runs in memory: pdf.js reads from the
// Uint8Array and never writes anything.
//
// pdf.js (~3 MB of JavaScript) is loaded by dynamic import on first use, so routes that never pre-check don't pay for
// it. Its "fake worker" runs in this isolate: we hand it the worker module through globalThis.pdfjsWorker instead of a
// URL, which workerd can't import.
//
// Privacy (§0.1): the result carries the PAN only so the caller can resolve the member (HMAC) and compare it with
// the engine's. Never log it, the text, or the passwords. Log `code`, `pages` and timings only.

export type StatementKind = 'CDSL' | 'RTA'

export type PrecheckResult =
  | {
      ok: true
      code: 'ok'
      kind: StatementKind
      /** Index into `candidates` of the password that opened the file, or null when it opened without one. */
      passwordIndex: number | null
      /** The holder's individual PAN when exactly one labelled one was found, else null (decide from the parse). */
      pan: string | null
      panStatus: 'found' | 'none' | 'ambiguous'
      pages: number
    }
  | { ok: false; code: 'password_required'; pages: null }
  | { ok: false; code: 'unrecognised'; pages: number | null }
  | { ok: false; code: 'too_large'; pages: number }

export const MAX_PAGES = 300

// Same keyword rules as detect_type() in engine/engine/parsers/__init__.py.
const CDSL_MARKERS = ['HELD IN DEMAT', 'CAS ID', 'CENTRAL DEPOSITORY']
const RTA_MARKERS = ['KFIN', 'CAMS', 'COMPUTER AGE']

// A PAN printed after a "PAN" label: "PAN: ABCDE1234F", "PAN No. ABCDE1234F", "PAN-ABCDE1234F".
const LABELLED_PAN = /PAN\s*[:-]?\s*(?:NO\.?\s*[:-]?\s*)?([A-Z]{5}[0-9]{4}[A-Z])/g

type PdfJs = typeof import('pdfjs-dist')
let pdfjsPromise: Promise<PdfJs> | undefined

/** Load pdf.js and its worker module once per isolate. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.mjs')])
    ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker
    lib.GlobalWorkerOptions.workerSrc ||= 'pdf.worker.mjs' // never imported: pdfjsWorker above takes precedence
    return lib
  })()
  pdfjsPromise.catch(() => (pdfjsPromise = undefined))
  return pdfjsPromise
}

export function detectKind(text: string): StatementKind | null {
  const t = text.toUpperCase()
  if (CDSL_MARKERS.some((m) => t.includes(m))) return 'CDSL'
  if (RTA_MARKERS.some((m) => t.includes(m))) return 'RTA'
  return null
}

/** Individual PANs (4th letter P) printed after a "PAN" label, also when the text splits them with whitespace. */
export function findHolderPans(text: string): Set<string> {
  const upper = text.toUpperCase()
  const pans = new Set<string>()
  for (const t of [upper, upper.replace(/\s+/g, '')]) {
    for (const m of t.matchAll(LABELLED_PAN)) {
      const pan = m[1]!
      if (pan[3] === 'P') pans.add(pan) // skip trust (T), company (C), HUF (H)… PANs, e.g. the AMC trust on KFintech
    }
  }
  return pans
}

/**
 * Pre-check one upload. `candidates` are tried in order (typed password, members' PANs, pending KFintech passwords);
 * a wrong one costs one key derivation, not a reload. The caller maps `passwordIndex` back to its `password_source`.
 */
export async function precheckPdf(bytes: Uint8Array, candidates: readonly string[]): Promise<PrecheckResult> {
  const pdfjs = await loadPdfJs()
  // pdf.js may transfer or detach the buffer it's given: pass a copy so the caller can still send the bytes on.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password: undefined,
    useSystemFonts: false, // text only: no fonts, canvas, wasm decoders or fetches are needed
    useWasm: false,
    useWorkerFetch: false,
    disableFontFace: true,
    stopAtErrors: false,
    verbosity: 0,
  })
  let tried = -1
  let outOfCandidates = false
  task.onPassword = (update: (password: string) => void) => {
    tried += 1
    if (tried < candidates.length) return update(candidates[tried]!)
    outOfCandidates = true
    void task.destroy()
  }
  try {
    let doc: Awaited<typeof task.promise>
    try {
      doc = await task.promise
    } catch (e) {
      if (outOfCandidates || (e as Error)?.name === 'PasswordException') return { ok: false, code: 'password_required', pages: null }
      return { ok: false, code: 'unrecognised', pages: null } // not a readable PDF
    }
    const pages = doc.numPages
    if (pages > MAX_PAGES) return { ok: false, code: 'too_large', pages }

    const texts: string[] = []
    for (let n = 1; n <= Math.min(3, pages); n++) texts.push(await pageText(doc, n))
    const kind = detectKind(texts.slice(0, 2).join(' '))
    if (!kind) return { ok: false, code: 'unrecognised', pages }

    const pans = findHolderPans(texts.join(' '))
    const pan = pans.size === 1 ? [...pans][0]! : null
    const panStatus = pans.size === 0 ? 'none' : pans.size === 1 ? 'found' : 'ambiguous'
    return { ok: true, code: 'ok', kind, passwordIndex: tried >= 0 ? tried : null, pan, panStatus, pages }
  } finally {
    await task.destroy()
  }
}

async function pageText(doc: { getPage(n: number): Promise<PdfPage> }, n: number): Promise<string> {
  const page = await doc.getPage(n)
  try {
    const content = await page.getTextContent()
    return content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('')
  } finally {
    page.cleanup()
  }
}

type PdfPage = {
  getTextContent(): Promise<{ items: Array<{ str: string; hasEOL: boolean } | object> }>
  cleanup(): void
}
