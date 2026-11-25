// Cloudflare Turnstile for the "Email me a link" form (plan §7.1, §13 item 1). Invisible unless Cloudflare needs an
// interaction ("interaction-only"); a fresh single-use token is fetched on each submit.
import { useCallback, useEffect, useRef } from "react"

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  execute: (id: string) => void
  reset: (id: string) => void
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

let loading: Promise<Turnstile> | null = null
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile unavailable")))
    s.onerror = () => {
      loading = null
      reject(new Error("Turnstile unavailable"))
    }
    document.head.appendChild(s)
  })
  return loading
}

/** Returns a ref for the widget's container and a function that resolves to a fresh token. */
export function useTurnstile(siteKey: string | null) {
  const ref = useRef<HTMLDivElement>(null)
  const widget = useRef<{ api: Turnstile; id: string } | null>(null)
  const pending = useRef<{ ok: (t: string) => void; fail: (e: Error) => void } | null>(null)

  useEffect(() => {
    if (!siteKey || !ref.current) return
    let cancelled = false
    loadTurnstile().then((api) => {
      if (cancelled || !ref.current) return
      const id = api.render(ref.current, {
        sitekey: siteKey,
        execution: "execute",
        appearance: "interaction-only",
        callback: (token: string) => pending.current?.ok(token),
        "error-callback": () => pending.current?.fail(new Error("Turnstile failed")),
        "expired-callback": () => api.reset(id),
      })
      widget.current = { api, id }
    }, () => {})
    return () => {
      cancelled = true
      if (widget.current) widget.current.api.remove(widget.current.id)
      widget.current = null
    }
  }, [siteKey])

  return {
    ref,
    getToken: useCallback(async (): Promise<string> => {
      const w = widget.current
      if (!w) throw new Error("We couldn't check that you're not a bot. Reload the page and try again.")
      w.api.reset(w.id) // tokens are single use
      const token = new Promise<string>((ok, fail) => (pending.current = { ok, fail }))
      w.api.execute(w.id)
      return token.finally(() => (pending.current = null))
    }, []),
  }
}
