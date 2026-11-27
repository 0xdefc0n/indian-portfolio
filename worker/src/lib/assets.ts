// Manual assets in D1 (plan §21.12, D28, M19): FD, PPF and EPF entered by hand.
//
// A row holds only the type in the clear. The inputs are sealed with the household DEK under the field key
// asset/{id}/inputs, so D1 has no amounts, rates or dates. Values are never stored: the SPA computes them from the
// inputs with lib/manual-assets.ts (and so does the export). Nothing here touches the snapshot, so no rebuild.
import { isUuid } from './blob'
import { ApiError, notFound } from './errors'
import { assetWriteQuota, LIMITS } from './limits'
import { type AssetInputs, type AssetType, parseInputs, todayIst } from './manual-assets'
import { isQuotaRefusal, quotaStatement, refusal } from './quota'
import type { Tenant } from './tenant'

export const assetFieldKey = (id: string) => `asset/${id}/inputs`

export type AssetView = { id: string; type: AssetType; member_id: string | null; inputs: AssetInputs; created_at: number; updated_at: number }

type AssetRow = { id: string; type: AssetType; member_id: string | null; inputs_enc: number[]; created_at: number; updated_at: number }
type HouseholdKeyRow = { dek_wrapped: number[]; kek_version: number }

/** Every asset, oldest first. One D1 round trip: the household key and the rows in a batch. */
export async function listAssets(t: Tenant): Promise<AssetView[]> {
  const db = t.env.DB
  const [keyRes, rowRes] = await db.batch([
    db.prepare('SELECT dek_wrapped, kek_version FROM household WHERE id = ?1').bind(t.householdId),
    db
      .prepare('SELECT id, type, member_id, inputs_enc, created_at, updated_at FROM manual_asset WHERE household_id = ?1 ORDER BY created_at, id')
      .bind(t.householdId),
  ])
  const rows = (rowRes?.results ?? []) as AssetRow[]
  const keyRow = keyRes?.results[0] as HouseholdKeyRow | undefined
  if (!rows.length || !keyRow) return []
  const vault = await t.vaultFromRow(keyRow)
  return Promise.all(rows.map(async (r) => view(r, JSON.parse(await vault.openText(assetFieldKey(r.id), r.inputs_enc)) as AssetInputs)))
}

const view = (r: Omit<AssetRow, 'inputs_enc'>, inputs: AssetInputs): AssetView => ({
  id: r.id,
  type: r.type,
  member_id: r.member_id,
  inputs,
  created_at: r.created_at,
  updated_at: r.updated_at,
})

/** 400 bad_input naming the field, never the value (plan §21.12). */
function checkedInputs(type: unknown, raw: unknown, now: number): AssetInputs {
  const res = parseInputs(type, raw, todayIst(now))
  if (!res.ok) throw new ApiError(400, 'bad_input', { field: res.field })
  return res.inputs
}

/** null (no member, D28), or a member of this household (else 404). */
async function memberOf(t: Tenant, raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null) return null
  return t.assertMember(raw)
}

/** Runs a write batch whose first statement is the daily write counter. */
async function withWriteQuota(t: Tenant, stmts: D1PreparedStatement[], now: number): Promise<D1Result[]> {
  const spec = assetWriteQuota(t.householdId)
  try {
    return await t.env.DB.batch([quotaStatement(t.env.DB, spec, now), ...stmts])
  } catch (err) {
    if (!isQuotaRefusal(err)) throw err
    const r = await refusal(t.env, [spec], now)
    throw new ApiError(429, 'asset_write_limit', { retry_after: r.retryAfter })
  }
}

export async function createAsset(t: Tenant, body: Record<string, unknown>, audit: D1PreparedStatement, now = Date.now()): Promise<AssetView> {
  const type = body.type as AssetType
  const inputs = checkedInputs(type, body.inputs, now)
  const memberId = await memberOf(t, body.member_id)
  const id = crypto.randomUUID()
  const sealed = await (await t.vault()).sealText(assetFieldKey(id), JSON.stringify(inputs))
  const results = await withWriteQuota(
    t,
    [
      t.env.DB.prepare(
        `INSERT INTO manual_asset (id, household_id, member_id, type, inputs_enc, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6 WHERE (SELECT COUNT(*) FROM manual_asset WHERE household_id = ?2) < ?7`,
      ).bind(id, t.householdId, memberId, type, sealed, now, LIMITS.assetsPerHousehold),
      audit, // onlyIfChanged: no row, no audit
    ],
    now,
  )
  if (!(results[1]?.meta.changes ?? 0)) throw new ApiError(409, 'asset_limit', { limit: LIMITS.assetsPerHousehold })
  return view({ id, type, member_id: memberId, created_at: now, updated_at: now }, inputs)
}

/** Replace the inputs and/or the member (also closed early, adjust a year, contributions stopped). */
export async function updateAsset(t: Tenant, id: string, body: Record<string, unknown>, audit: D1PreparedStatement, now = Date.now()): Promise<AssetView> {
  if (!isUuid(id)) throw notFound()
  const db = t.env.DB
  const row = await db
    .prepare('SELECT id, type, member_id, inputs_enc, created_at, updated_at FROM manual_asset WHERE id = ?1 AND household_id = ?2')
    .bind(id, t.householdId)
    .first<AssetRow>()
  if (!row) throw notFound()
  if (!('inputs' in body) && !('member_id' in body)) throw new ApiError(400, 'bad_input', { field: 'inputs' })
  const vault = await t.vault()
  const inputs = 'inputs' in body ? checkedInputs(row.type, body.inputs, now) : (JSON.parse(await vault.openText(assetFieldKey(id), row.inputs_enc)) as AssetInputs)
  const memberId = 'member_id' in body ? await memberOf(t, body.member_id) : row.member_id
  const sealed = await vault.sealText(assetFieldKey(id), JSON.stringify(inputs))
  const results = await withWriteQuota(
    t,
    [
      db
        .prepare('UPDATE manual_asset SET inputs_enc = ?1, member_id = ?2, updated_at = ?3 WHERE id = ?4 AND household_id = ?5')
        .bind(sealed, memberId, now, id, t.householdId),
      audit,
    ],
    now,
  )
  if (!(results[1]?.meta.changes ?? 0)) throw notFound() // deleted meanwhile
  return view({ ...row, member_id: memberId, updated_at: now }, inputs)
}

/** Delete one asset. Never counted against the daily writes: removing your data is always allowed. */
export async function deleteAsset(t: Tenant, id: string, audit: D1PreparedStatement): Promise<boolean> {
  if (!isUuid(id)) return false
  const [res] = await t.env.DB.batch([t.env.DB.prepare('DELETE FROM manual_asset WHERE id = ?1 AND household_id = ?2').bind(id, t.householdId), audit])
  return (res?.meta.changes ?? 0) > 0
}
