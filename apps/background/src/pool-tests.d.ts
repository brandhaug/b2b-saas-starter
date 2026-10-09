/// <reference types="@cloudflare/vitest-plugin/types" />

// Ambient types for the workers-pool tests (`src/*.pool.test.ts`). The reference
// above declares `cloudflare:test`, including its queue message and result types.

// The pool's env: the background worker's own `Env` plus the test-only
// migration binding `vitest.config.ts` installs. Inline `import()` types are
// load-bearing — a top-level import would turn this file into a module and
// the `Cloudflare.Env` merge below would stop reaching the `env` binding
// from `cloudflare:workers` (same discipline as `apps/web/src/worker-env.d.ts`:
// the intersection is named once, then merged as an interface).
type PoolEnv = {
  readonly TEST_MIGRATIONS: Array<{
    readonly name: string
    readonly queries: Array<string>
  }>
} & import('./queue-consumer.ts').Env

// Types the `env` binding from `cloudflare:workers` for the pool tests.
declare namespace Cloudflare {
  interface Env extends PoolEnv {}
}
