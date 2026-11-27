// FD, PPF and EPF entered by hand (plan §21.12, D28, M19). The Worker stores only the inputs; values are computed
// here, on every render, with the calculator the Worker uses too (@manual-assets → worker/src/lib/manual-assets.ts).
import { ASSET_CATEGORY, type AssetValue, assetName, type Flow, RATES, type RateTable, todayIst, valueAsset } from "@manual-assets"
import { useCallback, useEffect, useState } from "react"

import { api, type ManualAsset, SignedOut } from "@/lib/api"

export type AssetRow = ManualAsset & { name: string; category: string; v: AssetValue }

/** Today's approximate values, worked out from the inputs. */
export function valued(assets: ManualAsset[], rates: RateTable, today = todayIst()): AssetRow[] {
  return assets.map((a) => ({ ...a, name: assetName(a), category: ASSET_CATEGORY[a.type], v: valueAsset(a, today, rates) }))
}

/** The assets for the member switch: a member's own, or everyone's (including those filed under no member). */
export const forMember = (rows: AssetRow[], who: string | null) => (who === null ? rows : rows.filter((r) => r.member_id === who))

export const assetTotals = (rows: AssetRow[]) => ({
  value: rows.reduce((s, r) => s + r.v.value, 0),
  invested: rows.reduce((s, r) => s + r.v.invested, 0),
  gain: rows.reduce((s, r) => s + r.v.gain, 0),
})

/** Cash flows for Overall XIRR (funds and stocks plus these). */
export const assetFlows = (rows: AssetRow[]): Flow[] => rows.flatMap((r) => r.v.flows)

/** Loads /api/assets. A failure never breaks the page: the list is empty and `failed` is set. */
export function useAssets() {
  const [state, setState] = useState<{ assets: ManualAsset[] | null; rates: RateTable; failed: boolean }>({ assets: null, rates: RATES, failed: false })
  const reload = useCallback(() => {
    api.assets().then(
      (r) => setState({ assets: r.assets, rates: r.rates ?? RATES, failed: false }),
      (e: Error) => !(e instanceof SignedOut) && setState((s) => ({ ...s, assets: s.assets ?? [], failed: true })),
    )
  }, [])
  useEffect(reload, [reload])
  return { ...state, reload }
}
