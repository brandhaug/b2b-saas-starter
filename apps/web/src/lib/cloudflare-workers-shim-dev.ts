// Dev-server variant of the `cloudflare:workers` shim (aliased in
// vite.config.ts for `vite dev` only — test and build keep the inert shim so
// bundles never pull in wrangler). When packages/db has persisted local D1
// state (created by `bun run db:migrate:local`), that database is exposed as
// the `DB` binding through wrangler's getPlatformProxy, so credential sign-in
// and the Live capability layers run against the seeded data. Without that
// state — or when the proxy misses its boot deadline — this module behaves
// exactly like the base shim: `DB` stays undefined and the app runs
// provider-light on the Seed layer (CLAUDE.md rule 3).
//
// The dev module graph also serves this file to the browser (route modules
// import server helpers that reach `cloudflare:workers`), so everything
// Node-only stays behind the `import.meta.env.SSR` guard as dynamic imports —
// on the client this module evaluates to the base shim with `DB` undefined.
import { type D1Database } from '@cloudflare/workers-types'
import { env as baseEnv } from './cloudflare-workers-shim.ts'

// How long the workerd proxy gets to boot. This module is awaited at the top
// level, so every SSR request blocks until it settles: without a limit a
// workerd process that never comes up hangs the dev server with no output, and
// the e2e run reports only that the URL never answered.
const PROXY_BOOT_TIMEOUT_MS = 30_000

// The dynamic imports stay lazy loaders bound to descriptive names (they are
// also conditional: only the SSR path reaches them), hoisted so each is
// declared once instead of re-created per call.
function loadNodePath() {
  return import('node:path')
}

function loadLocalD1State() {
  return import('./local-d1-state.ts')
}

function loadWrangler() {
  return import('wrangler')
}

function loadNodeTimers() {
  return import('node:timers/promises')
}

async function provisionLocalD1(): Promise<D1Database | undefined> {
  if (!import.meta.env.SSR) return undefined
  // oxlint-disable-next-line effect/noNewPromise -- platform boundary: this module is awaited before any Effect runtime exists, same as the Promise.race below
  const [{ join }, localD1State] = await Promise.all([
    loadNodePath(),
    loadLocalD1State()
  ])
  if (!localD1State.hasLocalD1State()) return undefined
  // oxlint-disable-next-line effect/noNewPromise -- platform boundary: this module is awaited before any Effect runtime exists, same as the Promise.race below
  const [{ getPlatformProxy }, { setTimeout: delay }] = await Promise.all([
    loadWrangler(),
    loadNodeTimers()
  ])
  const pending = getPlatformProxy<{ DB: D1Database }>({
    configPath: join(localD1State.dbPackageDir, 'wrangler.jsonc'),
    persist: { path: localD1State.localD1PersistPath }
  })
  // The deadline is aborted as soon as the race settles, so a dev server that
  // booted normally does not hold an idle timer for the rest of the window.
  // Only the abort rejection is caught — it can arrive after the race only.
  const deadline = new AbortController()
  const expired = delay(PROXY_BOOT_TIMEOUT_MS, undefined, {
    signal: deadline.signal
  }).catch(() => undefined)
  // oxlint-disable-next-line effect/noNewPromise -- platform boundary: this module is awaited before any Effect runtime exists, and wrangler's getPlatformProxy hands back a bare Promise with no interruption channel
  const proxy = await Promise.race([pending, expired])
  deadline.abort()
  if (!proxy) {
    // A proxy that arrives after the limit would leave an orphan workerd
    // process behind, so shut it down. Nothing reads it any more.
    void pending.then((late) => late.dispose()).catch(() => undefined)
    console.warn(
      `[dev] local D1 did not attach within ${PROXY_BOOT_TIMEOUT_MS / 1000}s — continuing on the Seed layer (credential sign-in will not work)`
    )
    return undefined
  }
  // oxlint-disable-next-line no-console -- dev-server terminal is the intended surface for this one-time notice
  console.log('[dev] local D1 attached from packages/db/.wrangler (seeded state)')
  return proxy.env.DB
}

// Vite can re-evaluate this module across SSR module-graph invalidations; keep
// a single workerd proxy per dev-server process. The slot is declared on the
// global scope so the type checker knows it, rather than asserted onto
// `globalThis` at the use site.
declare global {
  // `var` is the only declaration form that adds a slot to the global scope.
  var b2bStarterLocalD1: Promise<D1Database | undefined> | undefined
}

globalThis.b2bStarterLocalD1 ??= provisionLocalD1()

export const env = { ...baseEnv, DB: await globalThis.b2bStarterLocalD1 }
