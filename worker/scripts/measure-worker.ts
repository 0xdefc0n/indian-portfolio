// Dev-only Worker for scripts/measure-pdfcheck.ts: runs the real pre-check on a POSTed PDF and returns the outcome
// and timings. Never deployed (it has its own wrangler config). Returns no PAN, text or password.
import { loadPdfJs, precheckPdf } from '../src/lib/pdfcheck'

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/load') {
      const t0 = Date.now()
      await loadPdfJs()
      return Response.json({ load_ms: Date.now() - t0 })
    }
    if (url.pathname !== '/precheck' || req.method !== 'POST') return new Response('not found', { status: 404 })
    const candidates = JSON.parse(atob(req.headers.get('x-candidates') ?? 'W10=')) as string[]
    const bytes = new Uint8Array(await req.arrayBuffer())
    const t0 = Date.now()
    const r = await precheckPdf(bytes, candidates)
    const ms = Date.now() - t0
    return Response.json({
      ok: r.ok,
      code: r.code,
      pages: r.pages,
      kind: r.ok ? r.kind : null,
      password_index: r.ok ? r.passwordIndex : null,
      pan_status: r.ok ? r.panStatus : null,
      ms,
    })
  },
}
