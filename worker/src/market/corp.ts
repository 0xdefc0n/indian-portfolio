// Corporate actions and NSE symbols (plan §21.6, M21). Public market data only: nothing here links to a user.
//
// Source (✅ 2026-11-27, live): NSE's corporate-action API answers a plain non-browser user agent. A "Mozilla" one
// stalls, as niftyindices does (M28), so `market-data/1.0` is used. www.nseindia.com 301s to www.nseindia.in.
//   GET /api/corporates-corporateActions?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY
//   → [{symbol, series, isin, comp, faceVal, subject, exDate "01-Oct-2026", recDate, …}]. 2017–2026 in one call
//   was 22,483 rows (6.9 MB, 2.8 s); 96% carry an ISIN.
// NSE's symbol list (`EQUITY_L.csv`, ~2,600 rows) gives each symbol's current ISIN: a face-value split usually gives
// the share a new ISIN, so actions and older tradebook rows are linked by symbol.
// ⚠️ NSE's terms for automated use are an M17 owner item, like Upstox's. Everything source-specific is in the
// "Source" section, so a licensed feed can replace it.
//
// Jobs (pf-market): `corp` fetches a date range and upserts; the 07:00 IST cron sends the last 30 days, and once the
// 2010-to-today backfill, a year per message. `symbols` refreshes EQUITY_L.csv weekly. A change bumps
// corp_state.version (part of every snapshot's inputs hash). Logs carry counts and error classes only.
import { istToday, ymdToIso } from './amfi'

export const CORP_CRON = '30 1 * * *' // 07:00 IST, with the morning price run
export const CORP_RECENT_DAYS = 30
export const CORP_BACKFILL_FROM_YEAR = 2010
export const SYMBOLS_EVERY_MS = 7 * 86_400_000
const ROWS_PER_STATEMENT = 500

export type CorpKind = 'split' | 'bonus' | 'dividend' | 'merger' | 'demerger' | 'other'
export type CorpAction = { symbol: string; ex_date: string; kind: CorpKind; subject: string; isin: string | null; num: number | null; den: number | null; amount: number | null }
export type SymbolRow = { symbol: string; isin: string; name: string }
export type CorpMessage = { type: 'corp'; from: string; to: string } | { type: 'symbols' }

export class CorpFormatError extends Error {
  override name = 'CorpFormatError'
}

// ─── Source: NSE (swap this section for another feed) ───────────────────────────────────────────────────────────

export const NSE_CA_URL = 'https://www.nseindia.com/api/corporates-corporateActions'
export const NSE_SYMBOLS_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv'
const USER_AGENT = 'market-data/1.0'
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }

const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
export const corpUrl = (from: string, to: string) => `${NSE_CA_URL}?index=equities&from_date=${dmy(from)}&to_date=${dmy(to)}`

/** "01-Oct-2026" → "2026-10-01" (null when it isn't a date). */
export function nseDate(s: unknown): string | null {
  const m = typeof s === 'string' ? /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim()) : null
  const mo = m ? MONTHS[m[2]!.toLowerCase()] : undefined
  return m && mo ? `${m[3]}-${mo}-${m[1]!.padStart(2, '0')}` : null
}

const money = (s: string) => Number(s.replace(/,/g, ''))

/**
 * One NSE subject → its actions. "Bonus 3:2" (3 new for every 2 held); "Face Value Split (Sub-Division) - From Rs 10/-
 * Per Share To Re 1/- Per Share" (10:1); "Dividend - Rs 1.50 Per Share" (also "Interim Dividend - Re 0.50 Per Share",
 * "Final Dividend - Rs 2 Per Share"); "Demerger"; "Amalgamation" / "Scheme Of Arrangement" (merger). Several actions
 * in one subject are split on "/". Anything unreadable is `other` and never applied.
 */
export function parseSubject(subject: string): Omit<CorpAction, 'symbol' | 'ex_date' | 'isin'>[] {
  const out: Omit<CorpAction, 'symbol' | 'ex_date' | 'isin'>[] = []
  const parts = subject.split(/\s*\/\s*(?=[A-Za-z])/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (const part of parts.length ? parts : [subject.trim()]) {
    const base = { subject: part.slice(0, 200), num: null, den: null, amount: null }
    const p = part.toLowerCase()
    let m: RegExpExecArray | null
    if (/scheme of ar+angement|bonus (n?crps|debenture|preference)/.test(p) && /bonus|redeemable|debenture|preference/.test(p)) {
      out.push({ ...base, kind: 'other' }) // bonus debentures/preference shares: not equity units
    } else if ((m = /bonus\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/.exec(p))) {
      out.push({ ...base, kind: 'bonus', num: Number(m[1]), den: Number(m[2]) })
    } else if ((m = /split.*?from\s*r[es]\.?\s*(\d+(?:\.\d+)?)\s*\/?-?.*?to\s*r[es]\.?\s*(\d+(?:\.\d+)?)/.exec(p))) {
      const from = Number(m[1])
      const to = Number(m[2])
      out.push(from > 0 && to > 0 && from > to ? { ...base, kind: 'split', num: from, den: to } : { ...base, kind: 'other' })
    } else if ((m = /dividend.*?r[es]\.?\s*([\d,]+(?:\.\d+)?)\s*(?:\/-)?\s*per\s*share/.exec(p))) {
      const amount = money(m[1]!)
      out.push(Number.isFinite(amount) && amount > 0 ? { ...base, kind: 'dividend', amount } : { ...base, kind: 'other' })
    } else if (/demerger/.test(p)) {
      out.push({ ...base, kind: 'demerger' })
    } else if (/amalgamation|merger|scheme of ar+angement/.test(p)) {
      out.push({ ...base, kind: 'merger' })
    } else {
      out.push({ ...base, kind: 'other' })
    }
  }
  return out
}

/** NSE's JSON → actions (equity series only; rows without a symbol or an ex-date are dropped). */
export function parseCorpActions(body: unknown): CorpAction[] {
  if (!Array.isArray(body)) throw new CorpFormatError('shape')
  const out: CorpAction[] = []
  for (const r of body as Record<string, unknown>[]) {
    const symbol = typeof r?.symbol === 'string' ? r.symbol.trim().toUpperCase() : ''
    const ex = nseDate(r?.exDate)
    const subject = typeof r?.subject === 'string' ? r.subject : ''
    const series = typeof r?.series === 'string' ? r.series : ''
    if (!symbol || !ex || !subject || !['EQ', 'BE', 'BZ', 'SM', 'ST', ''].includes(series)) continue
    const isin = typeof r.isin === 'string' && /^IN[A-Z0-9]{10}$/.test(r.isin) ? r.isin : null
    for (const a of parseSubject(subject)) out.push({ ...a, symbol, ex_date: ex, isin })
  }
  return out
}

/** EQUITY_L.csv → symbols (the header is checked by name; names with commas are quoted). */
export function parseSymbols(text: string): SymbolRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const split = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim())
  const head = split(lines[0] ?? '').map((h) => h.toUpperCase())
  const iSym = head.indexOf('SYMBOL')
  const iName = head.indexOf('NAME OF COMPANY')
  const iIsin = head.indexOf('ISIN NUMBER')
  if (iSym < 0 || iName < 0 || iIsin < 0) throw new CorpFormatError('header')
  const out: SymbolRow[] = []
  for (const l of lines.slice(1)) {
    const c = split(l)
    const symbol = c[iSym]?.toUpperCase() ?? ''
    const isin = c[iIsin]?.toUpperCase() ?? ''
    if (symbol && /^IN[A-Z0-9]{10}$/.test(isin)) out.push({ symbol, isin, name: (c[iName] ?? '').slice(0, 200) })
  }
  return out
}

async function get(url: string, tries = 3, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<Response> {
  let last: unknown
  for (let i = 1; i <= tries; i++) {
    if (i > 1) await sleep(2_000 * 4 ** (i - 2))
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(60_000) })
      if (res.ok) return res
      await res.body?.cancel()
      last = new CorpFormatError(`status ${res.status}`)
      if (res.status !== 429 && res.status < 500) break
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new CorpFormatError('fetch')
}

// ─── Store and jobs ─────────────────────────────────────────────────────────────────────────────────────────────

export type CorpRunOpts = { sleep?: (ms: number) => Promise<void> }

/** One `corp` message: fetch the range, upsert what's new or changed, bump the version if anything was. */
export async function runCorp(env: { MARKET: D1Database }, from: string, to: string, opts: CorpRunOpts = {}): Promise<{ rows: number; changed: number }> {
  const res = await get(corpUrl(from, to), 3, opts.sleep)
  const rows = parseCorpActions(await res.json().catch(() => null))
  const db = env.MARKET
  const stmts: D1PreparedStatement[] = []
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT).map((r) => [r.symbol, r.ex_date, r.kind, r.subject, r.isin, r.num, r.den, r.amount])
    stmts.push(
      db
        .prepare(
          `INSERT INTO corp_action (symbol, ex_date, kind, subject, isin, num, den, amount)
           SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'),
                  json_extract(value,'$[4]'), json_extract(value,'$[5]'), json_extract(value,'$[6]'), json_extract(value,'$[7]')
           FROM json_each(?1) WHERE true
           ON CONFLICT (symbol, ex_date, kind, subject) DO UPDATE SET isin = excluded.isin, num = excluded.num, den = excluded.den, amount = excluded.amount
           WHERE corp_action.isin IS NOT excluded.isin OR corp_action.num IS NOT excluded.num OR corp_action.den IS NOT excluded.den
              OR corp_action.amount IS NOT excluded.amount`,
        )
        .bind(JSON.stringify(chunk)),
    )
  }
  const out = stmts.length ? await db.batch(stmts) : []
  const changed = out.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  if (changed) await db.prepare('UPDATE corp_state SET version = version + 1 WHERE id = 1').run()
  console.log('corp', { rows: rows.length, changed })
  return { rows: rows.length, changed }
}

/** One `symbols` message: refresh NSE's symbol list. */
export async function runSymbols(env: { MARKET: D1Database }, now = Date.now(), opts: CorpRunOpts = {}): Promise<{ rows: number; changed: number }> {
  const res = await get(NSE_SYMBOLS_URL, 3, opts.sleep)
  const rows = parseSymbols(await res.text())
  if (rows.length < 100) throw new CorpFormatError('too_few') // a broken answer never empties the table
  const db = env.MARKET
  const stmts: D1PreparedStatement[] = []
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO nse_symbol (symbol, isin, name, seen_at)
           SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), ?2 FROM json_each(?1) WHERE true
           ON CONFLICT (symbol) DO UPDATE SET isin = excluded.isin, name = excluded.name, seen_at = excluded.seen_at
           WHERE nse_symbol.isin <> excluded.isin OR nse_symbol.name <> excluded.name`,
        )
        .bind(JSON.stringify(rows.slice(i, i + ROWS_PER_STATEMENT).map((r) => [r.symbol, r.isin, r.name])), now),
    )
  }
  const out = await db.batch(stmts)
  const changed = out.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  await db.prepare(`UPDATE corp_state SET symbols_at = ?1${changed ? ', version = version + 1' : ''} WHERE id = 1`).bind(now).run()
  console.log('nse_symbols', { rows: rows.length, changed })
  return { rows: rows.length, changed }
}

/**
 * The cron: the last 30 days of actions, the weekly symbol refresh, and (once) the backfill from 2010, a year per
 * message.
 */
export async function requestCorp(env: { MARKET: D1Database }, now: number, send: (msgs: CorpMessage[]) => Promise<void>): Promise<number> {
  const today = ymdToIso(istToday(now))
  const from = new Date(Date.parse(today) - CORP_RECENT_DAYS * 86_400_000).toISOString().slice(0, 10)
  const msgs: CorpMessage[] = [{ type: 'corp', from, to: today }]
  const state = await env.MARKET.prepare('SELECT backfill_asked_at, symbols_at FROM corp_state WHERE id = 1').first<{ backfill_asked_at: number | null; symbols_at: number | null }>()
  if (!state?.symbols_at || now - state.symbols_at >= SYMBOLS_EVERY_MS) msgs.unshift({ type: 'symbols' })
  if (!state?.backfill_asked_at) {
    for (let y = CORP_BACKFILL_FROM_YEAR; y <= Number(today.slice(0, 4)); y++) {
      msgs.push({ type: 'corp', from: `${y}-01-01`, to: y === Number(today.slice(0, 4)) ? today : `${y}-12-31` })
    }
    await env.MARKET.prepare('UPDATE corp_state SET backfill_asked_at = ?1 WHERE id = 1').bind(now).run()
  }
  await send(msgs)
  console.log('corp_request', { messages: msgs.length })
  return msgs.length
}

export async function corpVersion(env: { MARKET: D1Database }): Promise<number> {
  return (await env.MARKET.withSession('first-unconstrained').prepare('SELECT version FROM corp_state WHERE id = 1').first<number>('version')) ?? 0
}

export type CorpForBuild = { corp_actions: CorpAction[]; symbols: SymbolRow[]; fmv_2018: Record<string, number> }

/**
 * For a build: the symbols of the held ISINs and of the traded symbols/ISINs/names, then every action of those
 * symbols, and the 2018 highs of the held shares. Bounded: a household holds and trades at most a few hundred shares.
 */
export async function corpFor(env: { MARKET: D1Database }, isins: string[], symbols: string[], names: string[] = []): Promise<CorpForBuild> {
  const db = env.MARKET.withSession('first-unconstrained')
  const isinJson = JSON.stringify([...new Set(isins)])
  const [symRes, fmvRes] = await db.batch([
    db
      .prepare(
        `SELECT symbol, isin, name FROM nse_symbol WHERE isin IN (SELECT value FROM json_each(?1)) OR symbol IN (SELECT value FROM json_each(?2))
           OR upper(name) IN (SELECT upper(value) FROM json_each(?3))
         UNION SELECT s.symbol, s.isin, s.name FROM corp_action a JOIN nse_symbol s ON s.symbol = a.symbol WHERE a.isin IN (SELECT value FROM json_each(?1))`,
      )
      .bind(isinJson, JSON.stringify([...new Set(symbols.map((s) => s.toUpperCase()))]), JSON.stringify([...new Set(names)].slice(0, 500))),
    db.prepare('SELECT isin, high FROM stock_fmv_2018 WHERE isin IN (SELECT value FROM json_each(?1))').bind(isinJson),
  ])
  const syms = symRes!.results as SymbolRow[]
  const want = [...new Set([...syms.map((s) => s.symbol), ...symbols.map((s) => s.toUpperCase())])]
  const acts = want.length
    ? await db
        .prepare(
          `SELECT symbol, ex_date, kind, subject, isin, num, den, amount FROM corp_action
           WHERE (symbol IN (SELECT value FROM json_each(?1)) OR isin IN (SELECT value FROM json_each(?2))) AND kind <> 'other'
           ORDER BY symbol, ex_date`,
        )
        .bind(JSON.stringify(want), isinJson)
        .all<CorpAction>()
    : { results: [] as CorpAction[] }
  const fmv: Record<string, number> = {}
  for (const r of fmvRes!.results as { isin: string; high: number }[]) fmv[r.isin] = r.high
  return { corp_actions: acts.results, symbols: syms, fmv_2018: fmv }
}
