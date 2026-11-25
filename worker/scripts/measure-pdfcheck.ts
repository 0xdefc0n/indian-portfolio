// Measure the upload pre-check inside workerd (plan §3.3, M3): wall/CPU time per check and memory, for the private
// statements and a generated 10 MB / 300-page PDF. Runs the real wrangler bundle under `wrangler dev`.
//
//   cd worker && node scripts/measure-pdfcheck.ts            (Node ≥ 22.18 runs .ts directly)
//
// Prints only pdf<N>, page counts, sizes, outcome codes and numbers (§0.1). Memory is read two ways:
// - the Worker isolate's V8 heap + ArrayBuffer backing stores via the inspector (Runtime.getHeapUsage), right after
//   each check and before GC, so it includes the check's garbage;
// - peak RSS of the workerd process, sampled every ~10 ms, above its idle level. RSS includes ArrayBuffers (the PDF
//   bytes) and allocator slack, so it's the conservative number to compare with the 128 MB isolate limit.
// Local timings: Date.now() advances during CPU work in local workerd, and the check is CPU-bound, so wall ≈ CPU.
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cdslPages, FAKE_PAN, makePdf } from '../test/helpers/pdf-fixture.ts'
import { candidatePasswords, privatePdfPaths, WORKER_DIR } from '../test/helpers/private-pdfs.ts'

const PORT = 8799
const INSPECTOR = 9339
const RUNS = 5

type CheckOut = { ok: boolean; code: string; pages: number | null; password_index: number | null; ms: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function startWrangler() {
  const child = spawn(
    'npx',
    ['wrangler', 'dev', '-c', 'scripts/wrangler.measure.jsonc', '--port', String(PORT), '--inspector-port', String(INSPECTOR), '--ip', '127.0.0.1', '--log-level', 'error'],
    { cwd: WORKER_DIR, stdio: ['ignore', 'ignore', 'ignore'], detached: true },
  )
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/nope`)).status === 404) return child
    } catch {}
    await sleep(500)
  }
  throw new Error('wrangler dev did not start')
}

// Every workerd process (wrangler runs the user worker and its proxy in separate ones); stop other dev servers first.
const workerdPids = () => execFileSync('pgrep', ['-x', 'workerd']).toString().trim().split('\n').map(Number).filter(Boolean)

/** Total RSS of the workerd processes, in KB. Looked up each time: wrangler may restart workerd. */
function rssKb(): number {
  try {
    return execFileSync('ps', ['-o', 'rss=', '-p', workerdPids().join(',')])
      .toString()
      .trim()
      .split('\n')
      .reduce((a, l) => a + Number(l.trim() || 0), 0)
  } catch {
    return 0
  }
}

async function inspector() {
  const targets = (await (await fetch(`http://127.0.0.1:${INSPECTOR}/json`)).json()) as { webSocketDebuggerUrl: string }[]
  if (!targets[0]) return null
  // wrangler's inspector proxy wants an Origin header (Node's WebSocket accepts headers as an undici extension).
  const url = targets[0].webSocketDebuggerUrl.replace('//localhost:', '//127.0.0.1:')
  const ws = new (globalThis as any).WebSocket(url, { headers: { Origin: 'http://127.0.0.1' } }) // Node's, not workerd's
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)))
  let id = 0
  const pending = new Map<number, (v: any) => void>()
  ws.onmessage = (ev: { data: unknown }) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg.result ?? msg.error)
  }
  // Some replies never come back through the proxy: give up after 1.5 s and report NaN rather than hang.
  const send = (method: string, params = {}) =>
    new Promise<any>((res) => {
      const n = ++id
      const timer = setTimeout(() => (pending.delete(n), res(null)), 1500)
      pending.set(n, (v) => (clearTimeout(timer), pending.delete(n), res(v)))
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  return { send, close: () => ws.close() }
}

async function check(bytes: Uint8Array, candidates: string[]): Promise<CheckOut> {
  const res = await fetch(`http://127.0.0.1:${PORT}/precheck`, {
    method: 'POST',
    body: bytes,
    headers: { 'x-candidates': Buffer.from(JSON.stringify(candidates)).toString('base64') },
  })
  return res.json() as Promise<CheckOut>
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

async function main() {
  const child = await startWrangler()
  console.error('wrangler dev ready')
  try {
    const cdp = await inspector()
    // V8 heap plus ArrayBuffer backing stores (the PDF bytes, pdf.js buffers), as the inspector reports them.
    const heap = async () => {
      if (!cdp) return NaN
      const h = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number; backingStorageSize?: number } | null
      if (!h) return NaN
      return h.usedSize + (h.backingStorageSize ?? 0)
    }
    const gc = async () => cdp && (await cdp.send('HeapProfiler.collectGarbage'))

    await gc()
    const idleRss = rssKb()
    const heap0 = await heap()
    const load = (await (await fetch(`http://127.0.0.1:${PORT}/load`)).json()) as { load_ms: number }
    await gc()
    const heapLoaded = await heap()
    console.log(`pdf.js load (first call in an isolate): ${load.load_ms} ms; V8 heap ${mb(heap0)} → ${mb(heapLoaded)} MB after GC`)
    console.log(`workerd idle RSS (all workerd processes): ${(idleRss / 1024).toFixed(0)} MB`)

    const big = makePdf([...cdslPages(), ...Array.from({ length: 297 }, () => ['page'])], {
      userPassword: FAKE_PAN,
      linesPerPage: 60,
      padBytes: 9 * 1024 * 1024,
    })
    const cases = [
      ...privatePdfPaths().map((p, i) => ({ id: `pdf${i}`, bytes: new Uint8Array(readFileSync(p)), candidates: candidatePasswords(p) })),
      { id: 'synthetic 10 MB / 300 pages', bytes: big, candidates: ['wrong-1', FAKE_PAN] },
      { id: 'synthetic, all wrong (2 tries)', bytes: big, candidates: ['wrong-1', 'wrong-2'] },
    ]

    console.log('\n| PDF | size | pages | outcome | password index | check ms (median of 5; first) | isolate heap + buffers, after check (before GC) | peak RSS above idle |')
    console.log('|---|---|---|---|---|---|---|---|')
    for (const c of cases) {
      const times: number[] = []
      let out: CheckOut | undefined
      let peakRss = 0
      let heapAfter = 0
      for (let r = 0; r < RUNS; r++) {
        await gc()
        const base = await heap()
        const sampling = { on: true }
        const sampler = (async () => {
          while (sampling.on) {
            peakRss = Math.max(peakRss, rssKb() - idleRss)
            await sleep(10)
          }
        })()
        out = await check(c.bytes, c.candidates)
        sampling.on = false
        await sampler
        heapAfter = Math.max(heapAfter, (await heap()) - base)
        times.push(out.ms)
      }
      console.log(
        `| ${c.id} | ${mb(c.bytes.byteLength)} MB | ${out!.pages ?? '–'} | ${out!.code} | ${out!.password_index ?? '–'} | ${median(times)} (${times[0]}) | +${mb(heapAfter)} MB | ${(peakRss / 1024).toFixed(0)} MB |`,
      )
    }
    cdp?.close()
  } finally {
    try {
      process.kill(-child.pid!, 'SIGTERM')
    } catch {}
  }
}

await main()
