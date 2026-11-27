// Runs before each test file. Uploads now send nav-backfill messages, and the local queue delivers them to the
// pf-market consumer, which would call mfapi and AMFI. Tests never reach those hosts (nor BharatStock, M11): they
// answer 503 here (the consumer retries later), unless a test mocks fetch itself. Installed by assignment, not
// vi.spyOn, so vi.restoreAllMocks() in a test brings the guard back rather than the real fetch.
// Builds also ask for the stocks job (M11) and the AMC scrapers (M18): those sends are recorded instead
// (test/stocks.test.ts and test/amc.test.ts read them). AMC hosts are refused too unless a test mocks fetch.
import { ADAPTERS } from '../src/market/amc'
import { amcQueue } from '../src/market/amc-scrape'
import { stocksQueue } from '../src/market/stocks'

const MARKET_HOSTS = /(^|\.)(amfiindia\.com|mfapi\.in|bharatstockapi\.com|upstox\.com)$/
const AMC_HOSTS = new Set(ADAPTERS.flatMap((a) => a.hosts))
const realFetch = globalThis.fetch
;(globalThis as { pfRealFetch?: typeof fetch }).pfRealFetch = realFetch // test/stocks.live.test.ts only
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (MARKET_HOSTS.test(url.hostname) || AMC_HOSTS.has(url.host)) return new Response('blocked in tests', { status: 503 })
  return realFetch(input, init)
}) as typeof fetch

export const recordedStocks: number[] = []
;(globalThis as { pfRecordedStocks?: number[] }).pfRecordedStocks = recordedStocks
stocksQueue.send = async () => {
  recordedStocks.push(Date.now())
}

export const recordedAmc: number[] = []
;(globalThis as { pfRecordedAmc?: number[] }).pfRecordedAmc = recordedAmc
amcQueue.send = async () => {
  recordedAmc.push(Date.now())
}
