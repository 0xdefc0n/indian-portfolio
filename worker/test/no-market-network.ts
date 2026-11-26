// Runs before each test file. Uploads now send nav-backfill messages, and the local queue delivers them to the
// pf-market consumer, which would call mfapi and AMFI. Tests never reach those hosts: they answer 503 here (the
// consumer retries later), unless a test mocks fetch itself. Installed by assignment, not vi.spyOn, so
// vi.restoreAllMocks() in a test brings the guard back rather than the real fetch.
const MARKET_HOSTS = /(^|\.)(amfiindia\.com|mfapi\.in)$/
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (MARKET_HOSTS.test(url.hostname)) return new Response('blocked in tests', { status: 503 })
  return realFetch(input, init)
}) as typeof fetch
