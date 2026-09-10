import { starterEnv as capabilityStarterEnv } from '@b2b-saas-starter/capabilities/runtime'
import { type WebhookQueueBinding } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import {
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type NotificationEmailQueueBinding } from '@b2b-saas-starter/capabilities/notifications/notification-email-queue'
import { type ServerEnv } from '@b2b-saas-starter/env/server'
import { type WorkersAIBinding } from '@b2b-saas-starter/ai'
import {
  type ApiBindingName,
  type ApiRateLimitBindingName
} from '@b2b-saas-starter/infra'
import { type CloudflareRateLimit } from '@b2b-saas-starter/rate-limit'
import { securityEvidenceSink } from './security-evidence.ts'

/**
 * Binding name → binding type, one row per name `ApiBindingName` admits. The
 * env below maps the infra-derived key union through this record, so a
 * binding added in `infra/bindings.ts` fails this file's typecheck until its
 * row exists here — the key set cannot drift from the deploy silently. The
 * rate-limit buckets join as one mapped row: every bucket binding is the
 * same `CloudflareRateLimit` shape, so a bucket added to the infra name
 * record needs no new row below.
 */
type ApiBindingTypes = {
  readonly DB: D1Database
  readonly AI: WorkersAIBinding
  readonly WEBHOOK_QUEUE: WebhookQueueBinding
  readonly NOTIFICATION_EMAIL_QUEUE: NotificationEmailQueueBinding
  // Workspace export (ADR 0055): the queue to request one and the bucket to
  // serve signed downloads from. Both absent when unconfigured.
  readonly WORKSPACE_EXPORT_QUEUE: WorkspaceExportQueueBinding
  readonly WORKSPACE_EXPORT_BUCKET: WorkspaceExportBucketBinding
} & Readonly<Record<ApiRateLimitBindingName, CloudflareRateLimit>>

// The worker's Cloudflare bindings + redacted env: the keys come from infra
// (`ApiBindingName` in `@b2b-saas-starter/infra`, derived from the
// per-worker name records that mirror the env blocks the deploy binds),
// every one optional — a row says the deploy CAN bind it, never that it
// did, because a provider-gated binding is deliberately absent while its
// provider is unset.
// Shared by the handler layers, the web-handler assembly, and the fetch
// entrypoint. It structurally satisfies `ProviderEnv` (packages/ai), so the
// assistant selector takes this env straight — no key-by-key copy: an unset
// var is absent or undefined, and the selector reads both as unconfigured.
export type ApiEnv = Partial<Omit<ServerEnv, ApiBindingName>> &
  Readonly<Partial<{ [B in ApiBindingName]: ApiBindingTypes[B] }>>

// Capability env: the D1 binding selects Live vs Seed, and the webhook queue
// binding enables real fan-out. Add the API-owned evidence sink at this boundary.
export function starterEnv(env: ApiEnv) {
  return {
    ...capabilityStarterEnv(env),
    securityEvidence: securityEvidenceSink(env)
  }
}
