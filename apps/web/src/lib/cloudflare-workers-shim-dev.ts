// Dev-server variant of the `cloudflare:workers` shim (aliased in
// vite.config.ts for `vite dev` only — test and build keep the inert shim so
// bundles never pull in wrangler). When packages/db has persisted local D1
// state (created by `bun run db:migrate:local`), that database is exposed as
// the `DB` binding through wrangler's getPlatformProxy, so credential sign-in
// and the Live capability layers run against the seeded data. Without that
// state this module behaves exactly like the base shim: `DB` stays undefined
// and the app runs provider-light on the Seed layer (CLAUDE.md rule 3).
//
// The dev module graph also serves this file to the browser (route modules
// import server helpers that reach `cloudflare:workers`), so everything
// Node-only stays behind the `import.meta.env.SSR` guard as dynamic imports —
// on the client this module evaluates to the base shim with `DB` undefined.
import type { D1Database } from '@cloudflare/workers-types'
import { env as baseEnv } from './cloudflare-workers-shim.ts'

async function provisionLocalD1(): Promise<D1Database | undefined> {
  if (!import.meta.env.SSR) return undefined
  const { join } = await import('node:path')
  const { dbPackageDir, hasLocalD1State, localD1PersistPath } =
    await import('./local-d1-state.ts')
  if (!hasLocalD1State()) return undefined
  const { getPlatformProxy } = await import('wrangler')
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(dbPackageDir, 'wrangler.jsonc'),
    persist: { path: localD1PersistPath }
  })
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
