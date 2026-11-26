// Parity (M10): the private statements uploaded through the Worker (real engine /parse), built by the pf-rebuild
// consumer on a real EngineBatch container that reads its NAV series from R2 through market.internal, and served by
// GET /api/portfolio, equal the original local app's /api/portfolio on the same files (member ids aside), and the
// engine's own build. Expectations come from test/helpers/portfolio_expect.py via test/global-setup.ts; the PDFs are
// git-ignored and the test skips without them (CI).
// Privacy (§0.1): only differing JSON paths and counts are reported, never values. Don't use toEqual on snapshots.
import { env } from 'cloudflare:test'
import { describe, expect, inject, it } from 'vitest'
import { fieldKey } from '../src/lib/members'
import { runRebuild } from '../src/lib/snapshot'
import { seriesKey } from '../src/market/store'
import { call } from './helpers/auth'
import { takeRebuilds } from './helpers/snapshot'
import { newHousehold } from './helpers/tenant'
import { upload } from './helpers/upload'

const pdfs = inject('privatePdfs').filter((p) => p.engine.ok)
const expectedJson = inject('privatePortfolio')
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

type Snapshot = { members: { id: string }[]; holdings: { member_id: string }[]; activity: { member_id: string }[]; sips: { member_id: string }[] }
type Expected = {
  engine: Snapshot
  legacy: Snapshot | null
  navs: Record<string, { dates: string[]; navs: number[] }>
  isin_to_code: Record<string, string>
  members: Record<string, string> // engine member id → sha256(PAN)
  today: string
}

/** Where two JSON values differ, as paths only (as engine/tests/conftest.py diff_paths). */
function diffPaths(a: unknown, b: unknown, path = '$', out: string[] = [], limit = 20): string[] {
  if (out.length >= limit) return out
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = a as Record<string, unknown>
    const kb = b as Record<string, unknown>
    for (const k of [...new Set([...Object.keys(ka), ...Object.keys(kb)])].sort()) {
      if (!(k in ka) || !(k in kb)) out.push(`${path}.${k} (missing on one side)`)
      else diffPaths(ka[k], kb[k], `${path}.${k}`, out, limit)
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path} (length ${a.length} vs ${b.length})`)
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffPaths(a[i], b[i], `${path}[${i}]`, out, limit)
  } else if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-6) out.push(path)
  } else if (a !== b) out.push(path)
  return out
}

function remap(s: Snapshot, ids: Map<string, string>) {
  const to = (id: string) => ids.get(id) ?? `unmapped:${id}`
  for (const m of s.members) m.id = to(m.id)
  for (const key of ['holdings', 'activity', 'sips'] as const) for (const r of s[key]) r.member_id = to(r.member_id)
}

async function sha256(text: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

describe.skipIf(!pdfs.length || !expectedJson)(`snapshot parity on private statements (${pdfs.length} PDFs${expectedJson ? '' : ', no expectations'})`, () => {
  it('Worker snapshot = old app /api/portfolio = engine build (member ids aside)', { timeout: 600_000 }, async () => {
    const expected = JSON.parse(expectedJson!) as Expected
    const ist = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
    expect(ist, 'expectations computed on another day: re-run').toBe(expected.today)
    const h = await newHousehold('parity')

    // Upload every statement through the real engine.
    for (const p of pdfs) {
      const password = p.candidates[p.engine.password_index] ?? ''
      const { res, body } = await upload(h.jar, fromBase64(p.base64), password ? { password } : {})
      expect(res.status, `${p.id}: upload gave ${body.code}`).toBe(201)
    }
    expect(takeRebuilds(h.householdId).length, 'uploads asked for a rebuild').toBeGreaterThanOrEqual(pdfs.length)

    // The same NAV data the expectations used: R2 series (as nav-ingest writes them) and ISIN → code (tracked_scheme).
    for (const [code, s] of Object.entries(expected.navs)) {
      await env.BUCKET.put(seriesKey(Number(code)), JSON.stringify({ amfi_code: Number(code), ...s }))
    }
    const stmts = Object.entries(expected.isin_to_code).map(([isin, code]) =>
      env.MARKET.prepare(
        `INSERT INTO tracked_scheme (isin, amfi_code, amc, last_seen_at) VALUES (?1, ?2, NULL, ?3)
         ON CONFLICT (isin) DO UPDATE SET amfi_code = excluded.amfi_code`,
      ).bind(isin, Number(code), Date.now()),
    )
    const done = Object.keys(expected.navs).map((code) =>
      env.MARKET.prepare(`INSERT OR REPLACE INTO nav_backfill (amfi_code, status, at) VALUES (?1, 'done', ?2)`).bind(Number(code), Date.now()),
    )
    if (stmts.length + done.length) await env.MARKET.batch([...stmts, ...done])

    // One build on the real EngineBatch container.
    const t0 = Date.now()
    const built = await runRebuild(env, { household_id: h.householdId })
    expect(built.outcome).toBe('built')
    const buildMs = Date.now() - t0
    const res = await call('/api/portfolio', { jar: h.jar, headers: { 'accept-encoding': 'gzip' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-snapshot-building')).toBe('0')
    const got = await res.json<Snapshot>()

    // Worker member ids → the engine's, by PAN hash (computed here, never shown).
    const vault = await h.tenant.vault()
    const rows = await env.DB.prepare('SELECT id, pan_enc FROM member WHERE household_id = ?1').bind(h.householdId).all<{ id: string; pan_enc: number[] }>()
    const byHash = new Map(Object.entries(expected.members).map(([engineId, hash]) => [hash, engineId]))
    const ids = new Map<string, string>()
    for (const r of rows.results) ids.set(r.id, byHash.get(await sha256(await vault.openText(fieldKey.pan(r.id), r.pan_enc))) ?? 'no-match')
    remap(got, ids)

    const vsEngine = diffPaths(got, expected.engine)
    expect(vsEngine, 'Worker vs engine build differ at these paths').toEqual([])
    // The old app names members m0, m1… in the same value order. (null once app/ is gone)
    const legacy = expected.legacy
    if (legacy) remap(legacy, new Map(legacy.members.map((m, i) => [m.id, expected.engine.members[i]?.id ?? 'extra'])))
    const vsLegacy = legacy ? diffPaths(got, legacy) : []
    expect(vsLegacy, 'Worker vs old app differ at these paths').toEqual([])
    console.log(`parity ok: ${got.members.length} members, ${got.holdings.length} holdings, ${Object.keys(expected.navs).length} NAV series; build ${buildMs} ms; legacy ${expected.legacy ? 'compared' : 'gone'}`)
  })
})
