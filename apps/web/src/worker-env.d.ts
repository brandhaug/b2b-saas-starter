// The env shape is defined ONCE (`WebWorkerEnv`) and referenced by both the
// `Cloudflare.Env` namespace augmentation and the global `Env` interface.
// String vars derive from the `@b2b-saas-starter/env` schema —
// adding a var to `ServerEnvSchema` updates this file automatically.

// Optional provider env — forwarded by alchemy at deploy time.
//
// Inline `import()` types are load-bearing: a single top-level `import type`
// turns this file into a module, and the global `Env` / `Cloudflare.Env`
// declarations below then stop reaching the `env` binding from
// `cloudflare:workers`. Wrapping them in `declare global` does not rescue it
// either — global type ALIASES do not apply, so both declarations below must
// stay interfaces. `.oxlintrc.json` exempts `**/*.d.ts` from the two style
// rules that would otherwise reject this shape.
type WebWorkerEnv = {
  // Optional so the local workers shim (no D1) satisfies the same type;
  // consumers must handle the missing binding (Seed layer fallback).
  readonly DB?: D1Database
  readonly RATE_LIMITER_AUTH_READ?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
  readonly RATE_LIMITER_AUTH_WRITE?: import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
  // Cloudflare Email send binding. Optional and unwired by default: without it
  // the invite email goes through the logging dispatcher, which is what keeps
  // the invitation flow working with no provider configured (CLAUDE.md rule 3).
  readonly EMAIL?: import('@b2b-saas-starter/email').SendEmailBinding
} & Readonly<import('@b2b-saas-starter/env').ServerEnv>

// `env` from `cloudflare:workers` is typed as `Cloudflare.Env`
// (@cloudflare/workers-types uses `export = CloudflareWorkersModule`, so a
// `declare module` augmentation never applies); extending the namespace
// interface is the supported way to type project bindings.
declare namespace Cloudflare {
  interface Env extends WebWorkerEnv {}
}

interface Env extends WebWorkerEnv {}
