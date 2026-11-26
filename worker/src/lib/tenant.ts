// Tenant guard (plan §0.4, §9.1). Every read and write of user data goes through a Tenant, which carries the
// session's household_id and nothing from the client:
// - every SQL statement on user tables binds household_id from here;
// - any member or statement id from the client is checked with assertMember / assertStatement (404 if it isn't
//   this household's, so ids can't be probed);
// - R2 keys come from `keys`, built from server-side ids under this household's prefix;
// - the household DEK is unwrapped at most once per request (vault()).
import type { Context } from 'hono'
import type { AppBindings, AppEnv } from '../types'
import { blobKeys, isUuid } from './blob'
import { type Bytes, Vault } from './crypto'
import { notFound } from './errors'

export class Tenant {
  private vaultPromise: Promise<Vault> | null = null

  constructor(
    readonly env: AppEnv,
    readonly householdId: string,
    readonly userId: string,
  ) {}

  /** The household's data key, unwrapped once per request. */
  vault(): Promise<Vault> {
    this.vaultPromise ??= Vault.load(this.env, this.householdId)
    return this.vaultPromise
  }

  /** Use a household row already read in a batch, saving the vault's own D1 read. */
  vaultFromRow(row: { dek_wrapped: Bytes; kek_version: number }): Promise<Vault> {
    this.vaultPromise ??= Vault.fromRow(this.env, this.householdId, row)
    return this.vaultPromise
  }

  /** The member id if it belongs to this household; otherwise a 404. */
  async assertMember(memberId: unknown): Promise<string> {
    if (!isUuid(memberId)) throw notFound()
    const row = await this.env.DB.prepare('SELECT id FROM member WHERE id = ?1 AND household_id = ?2').bind(memberId, this.householdId).first()
    if (!row) throw notFound()
    return memberId
  }

  /** The statement id if it belongs to this household; otherwise a 404. */
  async assertStatement(statementId: unknown): Promise<string> {
    if (!isUuid(statementId)) throw notFound()
    const row = await this.env.DB.prepare('SELECT id FROM statement WHERE id = ?1 AND household_id = ?2').bind(statementId, this.householdId).first()
    if (!row) throw notFound()
    return statementId
  }

  readonly keys = {
    statement: (statementId: string) => blobKeys.statement(this.householdId, statementId),
    snapshot: (inputsHash: string) => blobKeys.snapshot(this.householdId, inputsHash),
    parkedPdf: (jobId: string) => blobKeys.parkedPdf(this.householdId, jobId),
  }
}

const perRequest = new WeakMap<Request, Tenant>()

/** The Tenant for this signed-in request (needs requireSession). */
export function tenant(c: Context<AppBindings>): Tenant {
  let t = perRequest.get(c.req.raw)
  if (!t) {
    t = new Tenant(c.env, c.var.householdId, c.var.user.id)
    perRequest.set(c.req.raw, t)
  }
  return t
}
