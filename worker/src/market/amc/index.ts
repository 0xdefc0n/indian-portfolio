// The AMC disclosure adapters (plan §10.3.1 rollout step 2: the ten largest fund houses). Same slugs as
// engine/engine/amc/__init__.py SLUGS. Which ones run is per environment: AMC_SCRAPERS (wrangler.jsonc vars).
import { absl } from './absl'
import { axis } from './axis'
import { hdfc } from './hdfc'
import { icici } from './icici'
import { kotak } from './kotak'
import { mirae } from './mirae'
import { nippon } from './nippon'
import { ppfas } from './ppfas'
import { sbi } from './sbi'
import type { AmcAdapter } from './types'
import { uti } from './uti'

export const ADAPTERS: readonly AmcAdapter[] = [sbi, icici, hdfc, nippon, kotak, axis, uti, absl, mirae, ppfas]

const BY_HOUSE = new Map(ADAPTERS.flatMap((a) => a.amfi.map((h) => [h, a] as const)))

/** The adapter for an AMFI fund-house name (`scheme.amc`, any case and spacing), if there is one. */
export function adapterFor(house: string | null | undefined): AmcAdapter | null {
  if (!house) return null
  return BY_HOUSE.get(house.toLowerCase().replace(/\s+/g, ' ').trim()) ?? null
}
