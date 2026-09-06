/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="@cloudflare/workers-types/experimental" />

// Ambient types for the workers-pool tests (`src/*.pool.test.ts`). The two
// references above pull in `cloudflare:test` (createMessageBatch,
// getQueueResult, applyD1Migrations, ...) and the service-binding queue
// result shapes (FetcherQueueResult, ServiceBindingQueueMessage) that live
// in the experimental subset of @cloudflare/workers-types — ambient modules
// and globals, so there is nothing to import explicitly.

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
