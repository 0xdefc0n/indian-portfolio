// Regenerates the install-dialog screenshots in public/screens/ (plan §13A.1) from DEMO data only: the synthetic
// engine fixture, with made-up names. Never point this at a real account.
//
//   npm run build && npx vite preview --port 4173 &
//   PLAYWRIGHT=<path to playwright> CHROME=<chromium executable> node scripts/pwa-screens.mjs
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const here = path.dirname(new URL(import.meta.url).pathname)
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? "playwright")
const BASE = process.env.BASE ?? "http://localhost:4173"

const snap = JSON.parse(readFileSync(path.join(here, "../../engine/tests/fixtures/golden_snapshot.json"), "utf8"))
const NAMES = { "Alpha Sample Person": "Asha Demo", "Beta Sample Person": "Ravi Demo" }
const portfolio = JSON.parse(JSON.stringify(snap).replaceAll(/Alpha Sample Person|Beta Sample Person/g, (n) => NAMES[n]).replaceAll("Synth", "Sample"))
const valueDate = portfolio.members.map((m) => m.value_date).sort().at(-1)

// A month of small daily moves ending on the snapshot's NAV day (made up, like everything here)
const total = portfolio.members.reduce((s, m) => s + m.total, 0)
const series = []
let v = total * 0.97
for (let i = 29; i >= 0; i--) {
  const d = new Date(`${valueDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - i)
  if ([0, 6].includes(d.getUTCDay())) continue
  const change = Math.round(v * (i === 0 ? 0.0042 : 0.004 * Math.sin(i * 1.7)))
  series.push({ date: d.toISOString().slice(0, 10), value: v + change, change, pct: (change / v) * 100, flag: null })
  v += change
}
const today = series.at(-1)
const share = (x) => ({ change: today.change * x, pct: today.pct })
const daily = {
  as_of: valueDate,
  coverage: { updated: portfolio.holdings.length, total: portfolio.holdings.length },
  today: {
    change: today.change,
    pct: today.pct,
    by_member: portfolio.members.map((m) => ({ member_id: m.id, ...share(m.total / total) })),
    by_fund: portfolio.holdings.map((h) => ({ member_id: h.member_id, isin: h.isin, nav_date: valueDate, ...share(h.value / total) })),
  },
  series,
  notes: { units_as_of: valueDate, units_exact: true, estimated: { instalments: 0, amount: 0 }, excluded: 0 },
}

const API = {
  "/api/me": { user: { name: "Asha Demo", email: "asha@example.com", image: null }, household: { id: "demo", created_at: 0 }, consent_ok: true, notice_version: "x" },
  "/api/portfolio": portfolio,
  "/api/portfolio/daily": daily,
  "/api/portfolio/status": { status: "ready" },
  "/api/market/status": { latest_nav_date: valueDate, coverage_pct: 100, final: true },
  "/api/jobs": { jobs: [] },
  "/api/config": { features: {}, kfintech_form_url: "", turnstile_site_key: "x" },
}

const browser = await chromium.launch({ executablePath: process.env.CHROME })
const shots = [
  // through the "Today's change" home-screen shortcut, so this also checks that it opens daily returns
  { file: "mobile-today.png", url: "/?view=today&source=shortcut", wait: "Daily returns", viewport: { width: 360, height: 640 }, scale: 3, mobile: true },
  { file: "desktop-overview.png", url: "/", wait: "Top holdings", viewport: { width: 1280, height: 720 }, scale: 1.5, mobile: false },
]
let errors = 0
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: s.scale, isMobile: s.mobile, hasTouch: s.mobile, colorScheme: "dark", serviceWorkers: "block" })
  const page = await ctx.newPage()
  page.on("pageerror", () => errors++)
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname
    const body = API[p]
    return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404, json: { ok: false, code: "not_found" } })
  })
  await page.goto(`${BASE}${s.url}`)
  await page.getByText(s.wait).first().waitFor()
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" })
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(here, "../public/screens", s.file) })
  await ctx.close()
}
await browser.close()
console.log(`screens: ${shots.length} written, page errors: ${errors}`)
