// The env shape is defined ONCE (`WebWorkerEnv`) and referenced by both the
// `Cloudflare.Env` namespace augmentation and the global `Env` interface.
// String vars derive from the `@b2b-saas-starter/env` `ServerEnv` type —
// adding a var there updates this file automatically — and binding keys
// from `WebBindingName` in `@b2b-saas-starter/infra`, the union derived
// from that package's per-worker records mirroring the env blocks the
// deploy binds: a binding added there fails this file's typecheck until a
// row exists in `WebBindingTypes` below.

// Optional provider env — forwarded by alchemy at deploy time.
//
// Inline `import()` types are load-bearing: a single top-level `import type`
// turns this file into a module, and the global `Env` / `Cloudflare.Env`
// declarations below then stop reaching the `env` binding from
// `cloudflare:workers`. Wrapping them in `declare global` does not rescue it
// either — global type ALIASES do not apply, so both declarations below must
// stay interfaces. The lint config exempts `**/*.d.ts` from the two style
// rules that would otherwise reject this shape.
type WebWorkerEnv = Readonly<
  Partial<{
    [B in import('@b2b-saas-starter/infra').WebBindingName]: WebBindingTypes[B]
  }>
> &
  Readonly<import('@b2b-saas-starter/env/server').ServerEnv>

/**
 * Binding name → binding type, one row per name `WebBindingName` admits.
 * `WebWorkerEnv` above maps the infra-derived key union through this
 * record, so a binding added in `infra/bindings.ts` fails this file's
 * typecheck until its row exists here — the key set cannot drift from the
 * deploy silently. Every key stays optional in `WebWorkerEnv`: a row says
 * the deploy CAN bind it, never that it did (CLAUDE.md rule 3). The auth
 * rate-limit buckets join as one mapped row — every bucket binding is the
 * same `CloudflareRateLimit` shape — so a bucket added to the infra name
 * record needs no new row below.
 */
type WebBindingTypes = {
  // Optional so the local workers shim (no D1) satisfies the same type;
  // consumers must handle the missing binding (Seed layer fallback).
  readonly DB: D1Database
  // Admin replay produces onto the existing background webhook queue.
  readonly WEBHOOK_QUEUE: import('@b2b-saas-starter/capabilities/developer-platform/webhook-publisher').WebhookQueueBinding
  // Producer port for instant notification emails (consumed by the background
  // worker). Optional: without it Notifications persist and no instant email
  // is enqueued — the digest cron still covers them (CLAUDE.md rule 3).
  readonly NOTIFICATION_EMAIL_QUEUE: import('@b2b-saas-starter/capabilities/notifications/notification-email-queue').NotificationEmailQueueBinding
  // Cloudflare Email send binding. Optional and unwired by default: without it
  // the invite email goes through the logging dispatcher, which is what keeps
  // the invitation flow working with no provider configured (CLAUDE.md rule 3).
  readonly EMAIL: import('@b2b-saas-starter/email').SendEmailBinding
  // Cloudflare Workers AI binding for the assistant. Optional and unwired by
  // default: without it (or without WORKERS_AI_ENABLED=true) the assistant
  // stays on its mock provider and the UI shows the honest not-enabled copy.
  readonly AI: import('@b2b-saas-starter/ai').WorkersAIBinding
  // Workspace data export (ADR 0055). Optional and unwired by default: without
  // both, `WorkspaceExports.availability` reports unavailable and the settings
  // page explains instead of offering a button.
  readonly WORKSPACE_EXPORT_QUEUE: import('@b2b-saas-starter/capabilities/governance/workspace-export').WorkspaceExportQueueBinding
  readonly WORKSPACE_EXPORT_BUCKET: import('@b2b-saas-starter/capabilities/governance/workspace-export').WorkspaceExportBucketBinding
  // Seat-sync queue producer. Optional and unwired by default: without it the
  // membership mutations publish nothing and seat sync heals on the next
  // mutation or provider webhook (CLAUDE.md rule 3).
  readonly BILLING_QUEUE: import(
    '@b2b-saas-starter/billing/seat-sync'
  ).SeatSyncQueueBinding
} & Readonly<
  Record<
    import('@b2b-saas-starter/infra').WebRateLimitBindingName,
    import('@b2b-saas-starter/rate-limit').CloudflareRateLimit
  >
>

// `env` from `cloudflare:workers` is typed as `Cloudflare.Env`
// (@cloudflare/workers-types uses `export = CloudflareWorkersModule`, so a
// `declare module` augmentation never applies); extending the namespace
// interface is the supported way to type project bindings.
declare namespace Cloudflare {
  interface Env extends WebWorkerEnv {}
}

interface Env extends WebWorkerEnv {}
