import { starterEnv } from '@b2b-saas-starter/capabilities/runtime'
import { type WebhookQueueBinding } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import {
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type NotificationEmailQueueBinding } from '@b2b-saas-starter/capabilities/notifications/notification-email-queue'
import { type ServerEnv } from '@b2b-saas-starter/env/server'
import { type WorkersAIBinding } from '@b2b-saas-starter/ai'
import { type ApiRateLimitBindingName } from '@b2b-saas-starter/infra'
import { type CloudflareRateLimit } from '@b2b-saas-starter/rate-limit'

// The rate-limit bindings this worker's env may carry, keyed by binding name
// and derived from the infra name record rather than spelled: renaming a
// binding in infra renames the key here and in the generated wrangler config
// together, and a bucket added to infra surfaces here the moment its row is
// written.
type RateLimitBindings = Readonly<
  Partial<Record<ApiRateLimitBindingName, CloudflareRateLimit>>
>

// The worker's Cloudflare bindings + redacted env. Shared by the handler
// layers, the web-handler assembly, and the fetch entrypoint. It structurally
// satisfies `ProviderEnv` (packages/ai), so the assistant selector takes this
// env straight — no key-by-key copy: an unset var is absent or undefined, and
// the selector reads both as unconfigured.
export type ApiEnv = RateLimitBindings &
  Partial<ServerEnv> & {
    readonly DB?: D1Database
    readonly AI?: WorkersAIBinding
    readonly WEBHOOK_QUEUE?: WebhookQueueBinding
    // Workspace export (ADR 0055): the queue to request one and the bucket to
    // serve signed downloads from. Both absent when unconfigured.
    readonly WORKSPACE_EXPORT_QUEUE?: WorkspaceExportQueueBinding
    readonly WORKSPACE_EXPORT_BUCKET?: WorkspaceExportBucketBinding
    readonly NOTIFICATION_EMAIL_QUEUE?: NotificationEmailQueueBinding
  }

// Capability env: the D1 binding selects Live vs Seed, and the webhook queue
// binding enables real fan-out. The projection lives beside `StarterEnv` in
// the capabilities package; this re-export keeps the local import path stable.
export { starterEnv }
