// Snapshots (plan §10.2, §10.3 prebuild, §16 "Jobs", M10): the pf-rebuild consumer (debounce, idempotency,
// single-flight claim, compare-and-set pointer, cleanup), the streamed GET /api/portfolio and /api/portfolio/status,
// lazy rebuilds on stale reads, and snapshot-prebuild. Fake engine /build; all data synthetic.
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blobKeys } from '../src/lib/blob'
import { acquireEngine, engineApi, type EngineLease, releaseLease } from '../src/lib/engine-client'
import { CLAIM_MS, FAILED_BACKOFF_MS, prebuild, requestRebuild, runRebuild, SNAPSHOT_VERSION, usedStatements } from '../src/lib/snapshot'
import { marketHooks } from '../src/market/jobs'
import { call } from './helpers/auth'
import { cdslPages, FAKE_PAN, FAKE_PAN_2 } from './helpers/pdf-fixture'
import { addMember, type Household, newHousehold, r2Keys } from './helpers/tenant'
import { captureQueue, deliver, fakeEngine, parsed, statementPdf, upload } from './helpers/upload'
import { type BuildBody, deliverRebuilds, fakeBuild, gunzipJson, setMarketDay, snapshotRow, storedStatement, takeRebuilds } from './helpers/snapshot'

vi.setConfig({ testTimeout: 30_000 })
let day = 20261101
beforeEach(async () => {
  await setMarketDay(++day) // every test starts on a fresh latest market day
  takeRebuilds()
})
afterEach(() => {
  vi.restoreAllMocks()
})

const iso = (ymd: number) => `${String(ymd).slice(0, 4)}-${String(ymd).slice(4, 6)}-${String(ymd).slice(6)}`
const snapshotKeys = (h: Household) => r2Keys(`${blobKeys.householdPrefix(h.householdId)}snapshot/`)
type Snap = { members: { id: string; name: string; statements: number }[]; market_date: string }

async function portfolio(h: Household, headers: Record<string, string> = { 'accept-encoding': 'gzip' }) {
  const res = await call('/api/portfolio', { jar: h.jar, headers })
  return { res, stale: res.headers.get('x-snapshot-stale'), building: res.headers.get('x-snapshot-building') }
}

/** A household with one member and one CDSL statement, built once. */
async function builtHousehold(tag: string) {
  const h = await newHousehold(tag)
  const member = await addMember(h, FAKE_PAN, 'SYNTHETIC HOLDER')
  await storedStatement(h, member)
  fakeBuild()
  await requestRebuild(env, h.householdId)
  const [r] = await deliverRebuilds(takeRebuilds(h.householdId))
  expect(r?.outcome).toBe('built')
  return { h, member }
}

describe('pf-rebuild consumer', () => {
  it('4 uploads in 5 s → 1 build (debounced messages, then inputs_hash)', async () => {
    const h = await newHousehold('debounce')
    fakeEngine(parsed(FAKE_PAN))
    const builds = fakeBuild()
    for (let i = 0; i < 4; i++) {
      const { res } = await upload(h.jar, statementPdf(cdslPages()), { password: FAKE_PAN })
      expect(res.status).toBe(201)
    }
    const sent = takeRebuilds(h.householdId)
    expect(sent).toHaveLength(4)
    expect(sent.every((m) => m.delay === 10)).toBe(true) // each arrives 10 s later: after the last upload
    const outcomes = await deliverRebuilds(sent)
    expect(outcomes.map((o) => o.outcome)).toEqual(['built', 'current', 'current', 'current'])
    expect(builds).toHaveLength(1)
    expect(builds[0]!.statements).toHaveLength(4) // all four statements in the one build
    expect(await snapshotKeys(h)).toHaveLength(1)
  })

  it('concurrent deliveries of the same inputs: one claims, the other stops', async () => {
    const h = await newHousehold('claim')
    const m = await addMember(h, FAKE_PAN, null)
    await storedStatement(h, m)
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    const builds = fakeBuild({ gate: () => gate })
    const first = runRebuild(env, { household_id: h.householdId })
    await vi.waitFor(() => expect(builds).toHaveLength(1))
    const second = await runRebuild(env, { household_id: h.householdId })
    expect(second.outcome).toBe('taken')
    open()
    expect((await first).outcome).toBe('built')
    expect(builds).toHaveLength(1)
  })

  it('race: an older build finishing after a newer one does not replace the pointer', async () => {
    const h = await newHousehold('race')
    const m = await addMember(h, FAKE_PAN, null)
    await storedStatement(h, m)
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    const builds = fakeBuild({ gate: (_req, n) => (n === 1 ? gate : Promise.resolve()) })

    const older = runRebuild(env, { household_id: h.householdId }) // build 1: one statement, held open
    await vi.waitFor(() => expect(builds).toHaveLength(1))
    await storedStatement(h, m, { asOf: '2026-11-15' }) // a second statement arrives meanwhile
    expect((await runRebuild(env, { household_id: h.householdId })).outcome).toBe('built') // build 2 wins
    const newer = await snapshotRow(h.householdId)
    open()
    expect((await older).outcome).toBe('superseded')

    const after = await snapshotRow(h.householdId)
    expect(after!.blob_key).toBe(newer!.blob_key)
    expect(await snapshotKeys(h)).toEqual([newer!.blob_key]) // the older build's blob was deleted
    const snap = await gunzipJson<Snap>(await fetchGzip(h))
    expect(snap.members[0]!.statements).toBe(2)
  })

  it('new snapshot under a new key, the previous blob deleted, no daily/tmp leftovers', async () => {
    const { h, member } = await builtHousehold('replace')
    fakeBuild()
    const first = (await snapshotRow(h.householdId))!.blob_key!
    expect(first.startsWith(`h/${h.householdId}/snapshot/`)).toBe(true)
    await storedStatement(h, member, { asOf: '2026-11-20' })
    expect((await runRebuild(env, { household_id: h.householdId })).outcome).toBe('built')
    const second = (await snapshotRow(h.householdId))!.blob_key!
    expect(second).not.toBe(first)
    expect(await snapshotKeys(h)).toEqual([second])
  })

  it('the blob is sealed: no JSON in a raw read', async () => {
    const { h } = await builtHousehold('sealed')
    const key = (await snapshotRow(h.householdId))!.blob_key!
    const raw = new TextDecoder('latin1').decode(await (await env.BUCKET.get(key))!.arrayBuffer())
    expect(raw.includes('"members"') || raw.includes('Holder')).toBe(false)
  })

  it('a failed build keeps the previous snapshot, marks failed, and is retried up to 3 times', async () => {
    const { h, member } = await builtHousehold('fail')
    const before = (await snapshotRow(h.householdId))!.blob_key
    fakeBuild({ answer: () => ({ ok: false, code: 'build_error' }) })
    await storedStatement(h, member, { asOf: '2026-11-21' })
    const r1 = await runRebuild(env, { household_id: h.householdId })
    expect(r1).toMatchObject({ outcome: 'retry', requeue: { delay: 30, msg: { attempts: 1 } } })
    const row = await snapshotRow(h.householdId)
    expect(row).toMatchObject({ status: 'failed', blob_key: before, building_hash: null })
    const r2 = await runRebuild(env, r1.requeue!.msg)
    const r3 = await runRebuild(env, r2.requeue!.msg)
    expect([r2.outcome, r3.outcome]).toEqual(['retry', 'failed'])
    expect(await snapshotKeys(h)).toEqual([before])
  })

  it('no free EngineBatch slot: waits with a ticket and builds later', async () => {
    const h = await newHousehold('wait')
    await storedStatement(h, await addMember(h, FAKE_PAN, null))
    const builds = fakeBuild()
    const held: EngineLease[] = []
    for (;;) {
      const r = await acquireEngine(env, { cls: 'batch' })
      if (!r.ok) break
      held.push(r)
    }
    const waited = await runRebuild(env, { household_id: h.householdId })
    expect(waited.outcome).toBe('waiting')
    expect(waited.requeue!.msg.ticket).toBeGreaterThan(0)
    expect(waited.requeue!.delay).toBeGreaterThanOrEqual(5)
    expect((await snapshotRow(h.householdId))!.status).toBe('ready') // no claim while waiting
    for (const l of held) await releaseLease(env, l)
    expect((await runRebuild(env, waited.requeue!.msg)).outcome).toBe('built')
    expect(builds).toHaveLength(1)
  })

  it('deleting the last statement empties the snapshot and deletes its blob', async () => {
    const { h } = await builtHousehold('empty')
    const st = await env.DB.prepare('SELECT id FROM statement WHERE household_id = ?1').bind(h.householdId).first<{ id: string }>()
    expect((await call(`/api/statements/${st!.id}`, { method: 'DELETE', jar: h.jar })).status).toBe(200)
    // Before the rebuild runs: status is pending (not empty) and the old snapshot isn't served.
    expect(await (await call('/api/portfolio/status', { jar: h.jar })).json()).toMatchObject({ status: 'pending', pending: true })
    expect(await (await portfolio(h)).res.json()).toMatchObject({ members: [] })
    expect(await deliverRebuilds(takeRebuilds(h.householdId))).toEqual([{ outcome: 'emptied' }])
    expect(await (await call('/api/portfolio/status', { jar: h.jar })).json()).toMatchObject({ status: 'empty', pending: false })
    expect((await snapshotRow(h.householdId))!.blob_key).toBeNull()
    expect(await snapshotKeys(h)).toEqual([])
    const { res, building } = await portfolio(h)
    expect(await res.json()).toMatchObject({ members: [], holdings: [] })
    expect(building).toBe('0')
  })

  it('member delete and rename ask for a rebuild; a rename reaches the engine, an unrenamed holder name does not', async () => {
    const { h, member } = await builtHousehold('rename')
    const builds = fakeBuild()
    expect((await call(`/api/members/${member}`, { method: 'PATCH', body: { name: 'Synthetic Nick' }, jar: h.jar })).status).toBe(200)
    await deliverRebuilds(takeRebuilds(h.householdId))
    expect(builds.at(-1)!.statements[0]!.name).toBe('Synthetic Nick')
    expect((await call(`/api/members/${member}`, { method: 'PATCH', body: { name: 'SYNTHETIC HOLDER' }, jar: h.jar })).status).toBe(200)
    await deliverRebuilds(takeRebuilds(h.householdId))
    expect(builds.at(-1)!.statements[0]!.name).toBeNull() // the engine title-cases the holder name itself
    expect((await call(`/api/members/${member}`, { method: 'DELETE', jar: h.jar })).status).toBe(200)
    expect(await deliverRebuilds(takeRebuilds(h.householdId))).toEqual([{ outcome: 'emptied' }])
  })

  it('a queued upload asks for a rebuild when it is stored', async () => {
    const h = await newHousehold('queued')
    fakeEngine(parsed(FAKE_PAN))
    vi.spyOn(engineApi, 'acquire').mockResolvedValueOnce({ ok: false, code: 'busy', queued_ahead: 0, eta_s: 5, ticket: 1 })
    const sent = captureQueue()
    const { res, body } = await upload(h.jar, statementPdf(cdslPages()), { password: FAKE_PAN })
    expect(res.status).toBe(202)
    expect(takeRebuilds(h.householdId)).toEqual([])
    await deliver(sent[0]!.job_id)
    expect(body.job).toBeTruthy()
    expect(takeRebuilds(h.householdId)).toHaveLength(1)
  })

  it('sends the market day, ISIN → code for CDSL funds and the codes still backfilling; follows up while they are', async () => {
    const h = await newHousehold('market')
    const m = await addMember(h, FAKE_PAN_2, null)
    await storedStatement(h, m, { isins: ['INF000C03033'] })
    await env.MARKET.batch([
      env.MARKET.prepare('INSERT OR REPLACE INTO tracked_scheme (isin, amfi_code, amc, last_seen_at) VALUES (?1, 777001, NULL, ?2)').bind('INF000C03033', Date.now()),
      env.MARKET.prepare(`INSERT OR REPLACE INTO nav_backfill (amfi_code, status, at) VALUES (777001, 'pending', ?1)`).bind(Date.now()),
    ])
    const builds = fakeBuild()
    const r = await runRebuild(env, { household_id: h.householdId })
    const req = builds[0] as BuildBody
    expect(req.market.market_date).toBe(iso(day))
    expect(req.market.nav_key).toBe(`${iso(day)}|1|100`)
    expect(req.market.isin_to_code).toEqual({ INF000C03033: '777001' })
    expect(req.market.refresh).toEqual(['777001'])
    expect(req.format).toBe('gzip')
    expect(r.requeue).toMatchObject({ delay: 120, msg: { force: true, followups: 1 } })
    // The backfill finishes: the follow-up builds once more (same inputs, forced) and stops following up.
    await env.MARKET.prepare(`UPDATE nav_backfill SET status = 'done' WHERE amfi_code = 777001`).run()
    const again = await runRebuild(env, r.requeue!.msg)
    expect(again).toEqual({ outcome: 'built' })
    expect(builds).toHaveLength(2)
    expect(await snapshotKeys(h)).toHaveLength(1)
  })

  it("waits for a sold fund's NAV backfill too (the value chart is rebuilt from every fund ever held)", async () => {
    const h = await newHousehold('sold')
    const m = await addMember(h, FAKE_PAN_2, null)
    await storedStatement(h, m, {
      kind: 'KFINTECH',
      isins: ['INF000C04044'],
      schemes: [
        { isin: 'INF000C04044', amfi: '777002', close: 1 },
        { isin: 'INF000C05055', amfi: '777003', close: 0 }, // fully redeemed: not tracked, but backfilled
      ],
    })
    await env.MARKET.prepare(`INSERT OR REPLACE INTO nav_backfill (amfi_code, status, at) VALUES (777003, 'pending', ?1)`).bind(Date.now()).run()
    const builds = fakeBuild()
    const r = await runRebuild(env, { household_id: h.householdId })
    expect((builds[0] as BuildBody).market.refresh).toEqual(['777003'])
    expect(r.requeue).toMatchObject({ msg: { force: true, followups: 1 } })
  })

  it('uses every CDSL statement and only the newest CAMS/KFintech one per member', () => {
    const row = (id: string, member_id: string, kind: 'CDSL' | 'CAMS' | 'KFINTECH', as_of: string, created_at = 0) =>
      ({ id, member_id, kind, as_of, created_at, blob_key: '' })
    const used = usedStatements([
      row('c1', 'a', 'CDSL', '2026-09-30'), row('c2', 'a', 'CDSL', '2026-10-31'),
      row('r1', 'a', 'CAMS', '2026-08-31'), row('r2', 'a', 'KFINTECH', '2026-11-20'), row('r3', 'a', 'CAMS', '2026-11-20', 5),
      row('r4', 'b', 'CAMS', '2026-07-31'),
    ])
    expect(used.map((s) => s.id).sort()).toEqual(['c1', 'c2', 'r3', 'r4'])
  })
})

async function fetchGzip(h: Household) {
  const key = (await snapshotRow(h.householdId))!.blob_key!
  const { bytes } = await (await h.tenant.vault()).open(key, await (await env.BUCKET.get(key))!.arrayBuffer())
  return bytes
}

describe('GET /api/portfolio', () => {
  it('needs a session', async () => {
    expect((await call('/api/portfolio')).status).toBe(401)
  })

  it('an empty household: the onboarding state, nothing asked', async () => {
    const h = await newHousehold('p-empty')
    const { res, stale, building } = await portfolio(h)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ members: [], holdings: [], activity: [], sips: [], benchmark: null })
    expect([stale, building]).toEqual(['0', '0'])
    expect(takeRebuilds(h.householdId)).toEqual([])
  })

  it('streams the sealed gzip as is (Content-Encoding: gzip), or decompressed for a client without gzip', async () => {
    const { h } = await builtHousehold('p-stream')
    const { res, stale, building } = await portfolio(h)
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect([stale, building]).toEqual(['0', '0'])
    // The caller's fetch decodes Content-Encoding (as a browser does): one decode gives the JSON, so the stored gzip
    // went out as is, not compressed again. Raw bytes on the wire are checked with wrangler dev + curl (M10 notes).
    expect((await res.json<Snap>()).members).toHaveLength(1)
    const plain = await portfolio(h, { 'accept-encoding': 'identity' })
    expect(plain.res.headers.get('content-encoding')).toBeNull()
    expect((await plain.res.json<Snap>()).members[0]!.name).toBe('Holder')
  })

  it('statements but no snapshot yet: building, and one lazy rebuild (not one per load)', async () => {
    const h = await newHousehold('p-lazy')
    await storedStatement(h, await addMember(h, FAKE_PAN, null))
    const first = await portfolio(h)
    expect(first.building).toBe('1')
    expect(await first.res.json()).toMatchObject({ members: [] })
    expect(takeRebuilds(h.householdId)).toHaveLength(1)
    await portfolio(h)
    expect(takeRebuilds(h.householdId)).toHaveLength(0) // already asked, not handled yet
  })

  it('stale snapshot served (X-Snapshot-Stale) then rebuilt on the new market day', async () => {
    const { h } = await builtHousehold('p-stale')
    fakeBuild()
    await setMarketDay(++day)
    const stale = await portfolio(h)
    expect([stale.res.status, stale.stale, stale.building]).toEqual([200, '1', '1'])
    expect((await stale.res.json<Snap>()).market_date).toBe(iso(day - 1))
    expect(await deliverRebuilds(takeRebuilds(h.householdId))).toEqual([{ outcome: 'built' }])
    const fresh = await portfolio(h)
    expect([fresh.stale, fresh.building]).toEqual(['0', '0'])
    expect((await fresh.res.json<Snap>()).market_date).toBe(iso(day))
  })

  it('a snapshot from an older SNAPSHOT_VERSION is stale on the same market day: the first read after a deploy rebuilds it', async () => {
    const { h } = await builtHousehold('p-version')
    expect((await snapshotRow(h.householdId))?.version).toBe(SNAPSHOT_VERSION)
    // as it was for households built before M12's deploy: same inputs and market day, older build (NULL version)
    await env.DB.prepare('UPDATE snapshot SET version = NULL WHERE household_id = ?1').bind(h.householdId).run()
    const old = await portfolio(h)
    expect([old.res.status, old.stale, old.building]).toEqual([200, '1', '1'])
    const status = await (await call('/api/portfolio/status', { jar: h.jar })).json<{ stale: boolean; status: string }>()
    expect(status).toMatchObject({ stale: true, status: 'pending' })
    fakeBuild()
    expect(await deliverRebuilds(takeRebuilds(h.householdId))).toEqual([{ outcome: 'built' }]) // not "current"
    const fresh = await portfolio(h)
    expect([fresh.stale, fresh.building]).toEqual(['0', '0'])
    expect((await snapshotRow(h.householdId))?.version).toBe(SNAPSHOT_VERSION)
  })

  it('a recent failure holds lazy rebuilds back for 10 minutes', async () => {
    const { h } = await builtHousehold('p-failed')
    await setMarketDay(++day)
    await env.DB.prepare(`UPDATE snapshot SET status = 'failed', failed_at = ?1 WHERE household_id = ?2`).bind(Date.now() - FAILED_BACKOFF_MS / 2, h.householdId).run()
    expect((await portfolio(h)).stale).toBe('1')
    expect(takeRebuilds(h.householdId)).toEqual([])
  })

  it('tenant isolation: another household never gets this snapshot', async () => {
    const { h } = await builtHousehold('p-iso-a')
    const b = await newHousehold('p-iso-b')
    const theirs = await portfolio(b)
    expect(await theirs.res.json()).toMatchObject({ members: [] })
    // Even a pointer edited to A's key (a bug) is refused: B's key can't open A's blob, and the key check stops it first.
    await env.DB.prepare('UPDATE snapshot SET blob_key = (SELECT blob_key FROM snapshot WHERE household_id = ?1) WHERE household_id = ?2').bind(h.householdId, b.householdId).run()
    expect(await (await portfolio(b)).res.json()).toMatchObject({ members: [] })
  })
})

describe('GET /api/portfolio/status', () => {
  it('pending after an upload (with Retry-After), ready once built', async () => {
    const h = await newHousehold('status')
    fakeEngine(parsed(FAKE_PAN))
    fakeBuild()
    expect(await (await call('/api/portfolio/status', { jar: h.jar })).json()).toMatchObject({ status: 'empty' })
    await upload(h.jar, statementPdf(cdslPages()), { password: FAKE_PAN })
    const pending = await call('/api/portfolio/status', { jar: h.jar })
    expect(await pending.json()).toMatchObject({ status: 'pending', pending: true, building: false })
    expect(pending.headers.get('retry-after')).toBe('3')
    await deliverRebuilds(takeRebuilds(h.householdId))
    const ready = await call('/api/portfolio/status', { jar: h.jar })
    expect(await ready.json()).toMatchObject({ status: 'ready', pending: false, stale: false, market_date: iso(day) })
    expect(ready.headers.get('retry-after')).toBeNull()
  })

  it('building while claimed; an expired claim is not reported as building', async () => {
    const { h } = await builtHousehold('status-b')
    await env.DB.prepare(`UPDATE snapshot SET status = 'building', building_hash = 'x', building_until = ?1 WHERE household_id = ?2`).bind(Date.now() + CLAIM_MS, h.householdId).run()
    expect(await (await call('/api/portfolio/status', { jar: h.jar })).json()).toMatchObject({ status: 'building', building: true })
    await env.DB.prepare('UPDATE snapshot SET building_until = ?1 WHERE household_id = ?2').bind(Date.now() - 1, h.householdId).run()
    expect(await (await call('/api/portfolio/status', { jar: h.jar })).json()).toMatchObject({ building: false })
  })
})

describe('snapshot-prebuild', () => {
  it('asks once per market date for recently active households with statements, spread over 30 min', async () => {
    const active = await builtHousehold('pre-active')
    const idle = await builtHousehold('pre-idle')
    const none = await newHousehold('pre-none')
    await env.DB.prepare('UPDATE household SET last_active_at = ?1 WHERE id = ?2').bind(Date.now() - 8 * 86_400_000, idle.h.householdId).run()
    await setMarketDay(++day)
    const out = await prebuild(env, { finalDates: [iso(day)] })
    expect(out.households).toBeGreaterThanOrEqual(1)
    const sent = takeRebuilds()
    const ids = sent.map((m) => m.msg.household_id)
    expect(ids).toContain(active.h.householdId)
    expect(ids).not.toContain(idle.h.householdId)
    expect(ids).not.toContain(none.householdId)
    expect(sent.every((m) => m.delay >= 0 && m.delay < 1800)).toBe(true)
    expect(await prebuild(env, { finalDates: [iso(day)] })).toEqual({ households: 0, skipped: 'done' }) // the 05:00 fallback
    expect(takeRebuilds()).toEqual([])
  })

  it('onFinal for a weekend/holiday date (not the latest full day) prebuilds nothing', async () => {
    await builtHousehold('pre-weekend')
    await setMarketDay(++day)
    await marketHooks.onFinal(env, [19990101])
    expect(takeRebuilds()).toEqual([])
    await marketHooks.onFinal(env, [day])
    expect(takeRebuilds().length).toBeGreaterThanOrEqual(1)
  })
})

describe('market day turning final', () => {
  it('a rebuild right after finality sees the new day state, even with the status edge-cached', async () => {
    const { h } = await builtHousehold('final-fresh')
    await setMarketDay(++day, { final: false, coverage: 60 })
    await call('/api/market/status') // the edge now caches the not-final state
    await deliverRebuilds([{ msg: { household_id: h.householdId }, delay: 0 }])
    const before = (await snapshotRow(h.householdId))!.inputs_hash
    await env.MARKET.prepare('UPDATE market_day SET final = 1, tracked_updated = tracked_total WHERE date = ?1').bind(day).run()
    const builds = fakeBuild()
    expect(await runRebuild(env, { household_id: h.householdId })).toEqual({ outcome: 'built' })
    expect(builds[0]!.market.nav_key).toBe(`${iso(day)}|1|100`)
    expect((await snapshotRow(h.householdId))!.inputs_hash).not.toBe(before)
  })
})
