// The env shape is defined ONCE (`WebWorkerEnv`) and referenced by both the
// `Cloudflare.Env` namespace augmentation and the global `Env` interface.
// String vars derive from the `@b2b-saas-starter/env` schema (ADR 0035) —
// adding a var to `ServerEnvSchema` updates this file automatically.

interface WebWorkerEnv extends Readonly<import('@b2b-saas-starter/env').ServerEnv> {
  readonly CUSTOMER_DIRECTORY_FINGERPRINT_KEY: string
  // Optional in the inert build shim; runtime reads fail degraded when absent.
  readonly DB?: D1Database
  /** Booking App service binding; absent only in test/provider-light contexts. */
  readonly BOOKING?: Fetcher
}

// `env` from `cloudflare:workers` is typed as `Cloudflare.Env`
// (@cloudflare/workers-types uses `export = CloudflareWorkersModule`, so a
// `declare module` augmentation never applies); extending the namespace
// interface is the supported way to type project bindings.
declare namespace Cloudflare {
  interface Env extends WebWorkerEnv {}
}

interface Env extends WebWorkerEnv {}
