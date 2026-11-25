// EngineFast / EngineBatch: Durable Objects that each own one engine container (plan §14, D16).
// Uses the runtime's ctx.container API directly: the @cloudflare/containers Container class is now the legacy path
// (verified M2). Never addressed directly by routes: callers get a slot name from EnginePool first.
import { DurableObject } from 'cloudflare:workers'

const ENGINE_PORT = 8080
/** Container stops after 60 s without requests (§3.6: keeps idle memory low). */
export const INACTIVITY_MS = 60_000
/** Cold start budget: image pull + Python import of the parsers. */
const READY_TIMEOUT_MS = 60_000
const READY_POLL_MS = 250

type InstanceType = NonNullable<ContainerStartupOptions['instance']>

export class EngineStartError extends Error {
  override name = 'EngineStartError'
}

abstract class EngineContainer extends DurableObject<Env> {
  protected abstract readonly instance: InstanceType
  private starting: Promise<void> | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // The timeout is per instance; re-apply it when this object restarts around an already-running container.
    if (ctx.container?.running) ctx.waitUntil(ctx.container.setInactivityTimeout(INACTIVITY_MS))
  }

  /**
   * Forwards a request to the engine, starting the container if needed, and adds X-Engine-Key.
   * The URL host is ignored; only path and query are used.
   */
  override async fetch(request: Request): Promise<Response> {
    const container = this.container()
    if (!container.running) {
      this.starting ??= this.start(container).finally(() => {
        this.starting = null
      })
    }
    if (this.starting) await this.starting

    const url = new URL(request.url)
    const headers = new Headers(request.headers)
    headers.set('X-Engine-Key', this.env.ENGINE_SHARED_SECRET)
    return container.getTcpPort(ENGINE_PORT).fetch(`http://engine${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.body,
    })
  }

  private container(): Container {
    const container = this.ctx.container
    if (!container) throw new EngineStartError('no container attached to this Durable Object')
    return container
  }

  private async start(container: Container): Promise<void> {
    if (!this.env.ENGINE_SHARED_SECRET) throw new EngineStartError('ENGINE_SHARED_SECRET is not set')
    const image = container.images.engine
    if (!image) throw new EngineStartError('image "engine" missing from wrangler.jsonc containers[].images')
    container.start({
      image,
      instance: this.instance,
      enableInternet: false, // the engine never calls out (engine/README.md); M18 scraping will allow-list hosts
      env: { ENGINE_SHARED_SECRET: this.env.ENGINE_SHARED_SECRET },
    })
    await container.setInactivityTimeout(INACTIVITY_MS)
    await waitUntilReady(container)
  }
}

async function waitUntilReady(container: Container): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  const port = container.getTcpPort(ENGINE_PORT)
  for (;;) {
    try {
      const res = await port.fetch('http://engine/health')
      await res.body?.cancel()
      if (res.ok) return
    } catch {
      // not listening yet
    }
    if (!container.running) throw new EngineStartError('engine container exited during start')
    if (Date.now() > deadline) throw new EngineStartError('engine did not become ready in time')
    await scheduler.wait(READY_POLL_MS)
  }
}

/** Uploads: a full core (~1.2 s per CDSL parse, §3.3). */
export class EngineFast extends EngineContainer {
  protected readonly instance = 'standard-2'
}

/** Rebuilds and scrapes: cheapest memory per job, nobody waits on them. */
export class EngineBatch extends EngineContainer {
  protected readonly instance = 'basic'
}
