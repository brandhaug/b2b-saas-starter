// The env shape is defined ONCE (`WebWorkerEnv`) and referenced by both the
// `Cloudflare.Env` namespace augmentation and the global `Env` interface.
// String vars derive from the `@b2b-saas-starter/env` schema (ADR 0035) —
// adding a var to `ServerEnvSchema` updates this file automatically.

// Optional module env (ADR 0035) — read by `makeStarterEnvModuleConfig` in
// `src/lib/capabilities.ts` to derive module config status. Inline `import()`
// types keep this file an ambient declaration (no top-level imports).
interface WebWorkerEnv extends Readonly<import('@b2b-saas-starter/env').ServerEnv> {
  // Optional so the local workers shim (no D1) satisfies the same type;
  // consumers must handle the missing binding (Seed layer fallback).
  readonly DB?: D1Database
  readonly RATE_LIMITER_AUTH_READ?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
  readonly RATE_LIMITER_AUTH_WRITE?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
}

// `env` from `cloudflare:workers` is typed as `Cloudflare.Env`
// (@cloudflare/workers-types uses `export = CloudflareWorkersModule`, so a
// `declare module` augmentation never applies); extending the namespace
// interface is the supported way to type project bindings.
declare namespace Cloudflare {
  interface Env extends WebWorkerEnv {}
}

interface Env extends WebWorkerEnv {}
