// Finding private statements (git-ignored) and their candidate passwords. Shared by test/global-setup.ts and
// scripts/measure-pdfcheck.ts; runs in Node only. Never print what these return.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export const WORKER_DIR = resolve(import.meta.dirname, '../..')
export const ROOT_DIR = resolve(WORKER_DIR, '..')
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/

/** A value from the environment or worker/.dev.vars. */
export function devVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  const file = join(WORKER_DIR, '.dev.vars')
  if (!existsSync(file)) return undefined
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m?.[1] === name && m[2]) return m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return undefined
}

/** $PRIVATE_DATA_DIR, else engine/tests/private/ and data/. */
export function privatePdfPaths(): string[] {
  const dirs = process.env.PRIVATE_DATA_DIR
    ? [resolve(process.env.PRIVATE_DATA_DIR)]
    : [join(ROOT_DIR, 'engine/tests/private'), join(ROOT_DIR, 'data')]
  return dirs
    .filter((d) => existsSync(d) && statSync(d).isDirectory())
    .flatMap((d) => readdirSync(d).filter((f) => f.toLowerCase().endsWith('.pdf')).sort().map((f) => join(d, f)))
}

/** Same order as engine.cli.candidates(): the PAN in the file name (<PAN>_<MONYYYY>…pdf), then TEST_PDF_PASSWORD. */
export function candidatePasswords(path: string, testPassword = devVar('TEST_PDF_PASSWORD')): string[] {
  const out: string[] = []
  const pan = basename(path).replace(/\.pdf$/i, '').split('_')[0]!.toUpperCase()
  if (PAN_RE.test(pan)) out.push(pan)
  if (testPassword) out.push(testPassword)
  return out.length ? out : ['']
}
