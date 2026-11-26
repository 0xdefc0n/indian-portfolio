// Plan §13A.2 / §13A.3: when the install prompt may show by itself, and what "Install" does on each platform.
import { describe, expect, it } from "vitest"

import {
  AFTER_UPLOAD_MS, countVisit, DAY_MS, detectPlatform, dismissed, EMPTY_RECORD, type EligibilityInput, installAction,
  installEligibility, isMobileUa, launchSource, MAX_DISMISSALS, SNOOZE_MS,
} from "./install"

const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidWebview: "Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.0.0 Mobile Safari/537.36",
  desktopChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  desktopEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0",
  iphoneWkWebview: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iphoneWhatsApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/25.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
  // iPadOS asks for the desktop site by default: a Mac UA, told apart by touch
  ipadDesktopMode: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
  firefoxDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.1; rv:145.0) Gecko/20100101 Firefox/145.0",
}

describe("detectPlatform", () => {
  it.each([
    ["androidChrome", 5, "chromium"],
    ["samsung", 5, "chromium"],
    ["desktopChrome", 0, "chromium"],
    ["desktopEdge", 0, "chromium"],
    ["androidWebview", 5, "webview"],
    ["iphoneSafari", 5, "ios"],
    ["iphoneChrome", 5, "ios"],
    ["iphoneInstagram", 5, "webview"],
    ["iphoneWkWebview", 5, "webview"],
    ["iphoneWhatsApp", 5, "webview"],
    ["ipad", 5, "ipad"],
    ["ipadDesktopMode", 5, "ipad"],
    ["macSafari", 0, "mac-safari"],
    ["firefoxDesktop", 0, "other"],
  ] as const)("%s → %s", (ua, touch, want) => {
    expect(detectPlatform(UA[ua], touch)).toBe(want)
  })

  it("phone and tablet vs computer", () => {
    expect(isMobileUa(UA.androidChrome)).toBe(true)
    expect(isMobileUa(UA.ipadDesktopMode, 5)).toBe(true)
    expect(isMobileUa(UA.desktopChrome)).toBe(false)
    expect(isMobileUa(UA.macSafari, 0)).toBe(false)
  })
})

describe("installAction", () => {
  it("chromium uses the held event, or nothing when the browser didn't offer one", () => {
    expect(installAction({ platform: "chromium", canPrompt: true, standalone: false })).toBe("prompt")
    expect(installAction({ platform: "chromium", canPrompt: false, standalone: false })).toBe("unsupported")
    expect(installAction({ platform: "chromium", canPrompt: false, standalone: false, installed: true })).toBe("installed")
  })
  it("Safari gets instructions; webviews and Firefox can't install; standalone is installed", () => {
    expect(installAction({ platform: "ios", canPrompt: false, standalone: false })).toBe("ios")
    expect(installAction({ platform: "ipad", canPrompt: false, standalone: false })).toBe("ipad")
    expect(installAction({ platform: "mac-safari", canPrompt: false, standalone: false })).toBe("mac")
    expect(installAction({ platform: "webview", canPrompt: false, standalone: false })).toBe("webview")
    expect(installAction({ platform: "other", canPrompt: false, standalone: false })).toBe("unsupported")
    expect(installAction({ platform: "ios", canPrompt: false, standalone: true })).toBe("installed")
  })
})

const NOW = Date.UTC(2026, 10, 27, 6)
/** A user who should see the prompt: second day, Android Chrome with the event held. */
const ok: EligibilityInput = {
  now: NOW,
  signedIn: true,
  consented: true,
  hasPortfolio: true,
  visitDays: 2,
  uploadedAt: null,
  dashboardMsSinceUpload: 0,
  standalone: false,
  launchedFromApp: false,
  action: "prompt",
  record: EMPTY_RECORD,
  busy: false,
  shownThisSession: false,
}
const why = (patch: Partial<EligibilityInput>) => {
  const r = installEligibility({ ...ok, ...patch })
  return r.show ? "show" : r.why
}

describe("installEligibility (plan §13A.2)", () => {
  it("shows on a later day once everything holds", () => {
    expect(why({})).toBe("show")
    expect(why({ action: "ios" })).toBe("show")
    expect(why({ action: "mac" })).toBe("show")
  })

  it("never on first arrival: the first day needs 20 s on the dashboard after the first upload", () => {
    expect(why({ visitDays: 1 })).toBe("no_value_yet")
    expect(why({ visitDays: 1, uploadedAt: NOW - 5_000, dashboardMsSinceUpload: 5_000 })).toBe("no_value_yet")
    expect(why({ visitDays: 1, uploadedAt: NOW - 30_000, dashboardMsSinceUpload: AFTER_UPLOAD_MS - 1 })).toBe("no_value_yet")
    expect(why({ visitDays: 1, uploadedAt: NOW - 30_000, dashboardMsSinceUpload: AFTER_UPLOAD_MS })).toBe("show")
  })

  it("never before sign-in, consent or a portfolio", () => {
    expect(why({ signedIn: false })).toBe("signed_out")
    expect(why({ consented: false })).toBe("no_consent")
    expect(why({ hasPortfolio: false })).toBe("no_portfolio")
  })

  it("never while installed", () => {
    expect(why({ standalone: true })).toBe("installed")
    expect(why({ launchedFromApp: true })).toBe("installed")
    expect(why({ record: { ...EMPTY_RECORD, installed: true } })).toBe("installed")
    expect(why({ action: "installed" })).toBe("installed")
  })

  it("never where the platform can't install", () => {
    expect(why({ action: "webview" })).toBe("cannot_install")
    expect(why({ action: "unsupported" })).toBe("cannot_install")
  })

  it("not within 14 days of a dismissal, and never after 3", () => {
    const once = dismissed(EMPTY_RECORD, NOW - SNOOZE_MS + 1)
    expect(once).toEqual({ dismissals: 1, lastDismissedAt: NOW - SNOOZE_MS + 1, installed: false })
    expect(why({ record: once })).toBe("dismissed_recently")
    expect(why({ record: dismissed(EMPTY_RECORD, NOW - SNOOZE_MS) })).toBe("show")
    expect(why({ record: { dismissals: 2, lastDismissedAt: NOW - 30 * DAY_MS, installed: false } })).toBe("show")
    expect(why({ record: { dismissals: MAX_DISMISSALS, lastDismissedAt: NOW - 365 * DAY_MS, installed: false } })).toBe("dismissed_too_often")
  })

  it("not while something else is going on, and at most once per session", () => {
    expect(why({ busy: true })).toBe("busy")
    expect(why({ shownThisSession: true })).toBe("shown_this_session")
  })
})

describe("visits and launch source", () => {
  it("counts distinct days only", () => {
    let r = { days: 0, last: null as string | null }
    r = countVisit(r, "2026-11-27")
    r = countVisit(r, "2026-11-27")
    expect(r).toEqual({ days: 1, last: "2026-11-27" })
    expect(countVisit(r, "2026-11-28")).toEqual({ days: 2, last: "2026-11-28" })
  })
  it("reads ?source=", () => {
    expect(launchSource("?source=pwa")).toBe("pwa")
    expect(launchSource("?view=today&source=shortcut")).toBe("shortcut")
    expect(launchSource("?source=email")).toBe(null)
    expect(launchSource("")).toBe(null)
  })
})
