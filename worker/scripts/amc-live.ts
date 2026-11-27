// Run one AMC adapter's discover() against the real site, and optionally download the files (plan §10.3.1, M18).
//   npx tsx scripts/amc-live.ts <slug> <YYYY-MM> [out-dir]
// Then parse what was downloaded with the engine:  cd ../engine && uv run python -m engine.amc.cli <slug> <out-dir>/*
// Same politeness as the Worker (robots.txt, ≥ 1 s per host, the adapter's hosts only). Public market data only:
// prints counts, file names and sizes.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AmcFetcher } from '../src/market/amc/fetcher'
import type { AmcAdapter } from '../src/market/amc/types'

const [slug, month, out] = process.argv.slice(2)
if (!slug || !/^[a-z0-9_]+$/.test(slug) || !month || !/^\d{4}-\d{2}$/.test(month)) {
  console.error('usage: npx tsx scripts/amc-live.ts <slug> <YYYY-MM> [out-dir]')
  process.exit(2)
}
const mod = (await import(`../src/market/amc/${slug}.ts`)) as Record<string, AmcAdapter>
const adapter = Object.values(mod).find((v) => v && typeof v === 'object' && 'discover' in v)
if (!adapter) throw new Error(`no adapter exported from ${slug}.ts`)
if (adapter.blocked) console.log('blocked:', adapter.blocked)

const http = new AmcFetcher(adapter.hosts, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) })
const t0 = Date.now()
const files = await adapter.discover(month, http)
console.log(`discover ${slug} ${month}: ${files.length} file(s), ${http.stats.requests} request(s), ${Date.now() - t0} ms`)
for (const f of files.slice(0, 50)) console.log('  ', f.name ?? decodeURIComponent(new URL(f.url).pathname.split('/').pop() ?? ''), f.init?.method ?? 'GET')
if (out && files.length) {
  mkdirSync(out, { recursive: true })
  for (const [i, f] of files.entries()) {
    const bytes = await http.file(f.url, f.init)
    const name = (f.name ?? decodeURIComponent(new URL(f.url).pathname.split('/').pop() ?? `file-${i}`)).replace(/[^\w.-]+/g, '_')
    writeFileSync(join(out, name), bytes)
    console.log(`  saved ${name} ${bytes.byteLength} bytes`)
  }
  console.log(`total ${http.stats.requests} request(s), ${http.stats.bytes} bytes, ${Date.now() - t0} ms`)
}
