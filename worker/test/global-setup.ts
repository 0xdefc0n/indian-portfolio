// Runs in Node before the workerd tests. Loads private statements (git-ignored) for pdfcheck.private.test.ts and asks
// the Python engine what it makes of each one. Nothing here is printed: tests see the bytes, the candidate passwords
// and the engine's answer (type, password index, SHA-256 of the parsed PAN), and report booleans and counts only.
// With no private PDFs (CI), it provides an empty list and those tests skip.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { candidatePasswords, devVar, privatePdfPaths, ROOT_DIR, WORKER_DIR } from './helpers/private-pdfs.ts'

export type EngineExpectation = {
  ok: boolean
  code: string | null
  kind: 'CDSL' | 'RTA' | null
  password_index: number
  pan_sha256: string | null
}
export type PrivatePdf = { id: string; base64: string; candidates: string[]; engine: EngineExpectation }

declare module 'vitest' {
  export interface ProvidedContext {
    privatePdfs: PrivatePdf[]
    privatePdfsSkipReason: string | null
    /** test/helpers/portfolio_expect.py's JSON (expected snapshots + NAV data), or null. Never printed. */
    privatePortfolio: string | null
    /** BHARATSTOCK_LIVE=1 only: the real key and a synthetic statement for test/stocks.live.test.ts. Never printed. */
    stocksLive: string | null
  }
}

export default function setup(project: TestProject) {
  const paths = privatePdfPaths()
  let skip: string | null = paths.length ? null : 'no private statements available'
  let pdfs: PrivatePdf[] = []
  if (!skip) {
    const testPassword = devVar('TEST_PDF_PASSWORD')
    try {
      const out = execFileSync('uv', ['run', '--directory', join(ROOT_DIR, 'engine'), 'python', join(WORKER_DIR, 'test/helpers/engine_expect.py'), ...paths], {
        env: { ...process.env, TEST_PDF_PASSWORD: testPassword ?? '' },
        stdio: ['ignore', 'pipe', 'ignore'], // stderr could carry parser warnings: never shown
        maxBuffer: 1 << 20,
      })
      const engine = JSON.parse(out.toString()) as EngineExpectation[]
      pdfs = paths.map((p, i) => ({
        id: `pdf${i}`, // never the file name: it contains the PAN
        base64: readFileSync(p).toString('base64'),
        candidates: candidatePasswords(p, testPassword),
        engine: engine[i]!,
      }))
    } catch (e) {
      skip = `engine expectations unavailable (${(e as Error).name})` // e.g. uv not installed
    }
  }
  let portfolio: string | null = null
  if (!skip) {
    try {
      portfolio = execFileSync('uv', ['run', '--directory', join(ROOT_DIR, 'engine'), 'python', join(WORKER_DIR, 'test/helpers/portfolio_expect.py'), ...paths], {
        env: { ...process.env, TEST_PDF_PASSWORD: devVar('TEST_PDF_PASSWORD') ?? '' },
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 256 << 20,
      }).toString()
    } catch {
      portfolio = null // the parity test skips and says why
    }
  }
  project.provide('privatePortfolio', portfolio)
  project.provide('stocksLive', stocksLive())
  project.provide('privatePdfs', pdfs)
  project.provide('privatePdfsSkipReason', skip)
}

/**
 * The M11 live check (opt-in: BHARATSTOCK_LIVE=1 npx vitest run test/stocks.live.test.ts). The engine's synthetic
 * KFintech statement with its made-up flexi cap fund renamed to a real public fund, so the real BharatStock API has a
 * portfolio to match. No personal data: the holder, PAN and amounts are the synthetic fixture's.
 */
function stocksLive(): string | null {
  const key = process.env.BHARATSTOCK_LIVE === '1' ? devVar('BHARATSTOCK_API_KEY') : undefined
  if (!key) return null
  const code = 'import json; from tests.fixtures import synthetic; print(json.dumps(synthetic.statements()[1]["data"]))'
  const raw = execFileSync('uv', ['run', '--directory', join(ROOT_DIR, 'engine'), 'python', '-c', code], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  const statement = raw.replaceAll('INF000S01FC1', 'INF879O01027').replaceAll('SYNTH FLEXI CAP FUND', 'PARAG PARIKH FLEXI CAP FUND')
  return JSON.stringify({ key, statement: JSON.parse(statement) })
}
