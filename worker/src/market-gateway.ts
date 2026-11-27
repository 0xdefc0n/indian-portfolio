// The engine container's only way out (plan §10.2, M10). EngineBatch starts its container with no internet and routes
// HTTP for one made-up host, market.internal, to this entrypoint. It serves the public NAV series that nav-ingest
// writes to R2 (`market/nav/{code}.json`) and the exchange-price series of shares and bonds (`market/px/{isin}.json`,
// M20), and nothing else: no other prefix, no writes, no listing. So no R2
// credentials enter the container, and decrypted statements inside it have no route to the internet.
import { WorkerEntrypoint } from 'cloudflare:workers'
import { priceSeriesKey } from './market/prices'
import { seriesKey } from './market/store'

/** The host the engine reads NAVs from (NAV_STORE_URL in the container). */
export const MARKET_HOST = 'market.internal'
export const NAV_STORE_URL = `http://${MARKET_HOST}/nav/`

const NAV_PATH = /^\/nav\/(\d{1,9})\.json$/
const PRICE_PATH = /^\/px\/(IN[E9][0-9A-Z]{9})\.json$/

export class MarketGateway extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    return serveMarket(this.env, request)
  }
}

/** GET /nav/{code}.json or /px/{isin}.json → the R2 series as stored. Everything else is refused. */
export async function serveMarket(env: { BUCKET: R2Bucket }, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const nav = NAV_PATH.exec(url.pathname)
  const px = nav ? null : PRICE_PATH.exec(url.pathname)
  if (request.method !== 'GET' || url.hostname !== MARKET_HOST || !(nav || px)) return new Response('forbidden', { status: 403 })
  const obj = await env.BUCKET.get(nav ? seriesKey(Number(nav[1])) : priceSeriesKey(px![1]!))
  if (!obj) return new Response('not found', { status: 404 })
  return new Response(obj.body, { headers: { 'content-type': 'application/json', 'content-length': String(obj.size) } })
}
