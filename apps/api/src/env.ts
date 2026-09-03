import { starterEnv } from '@b2b-saas-starter/capabilities/runtime'
import { type WebhookQueueBinding } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import {
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type ServerEnv } from '@b2b-saas-starter/env/server'
import { type WorkersAIBinding } from '@b2b-saas-starter/ai'

import { type RateLimitBindings } from './rate-limit.ts'

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
    // Workspace export (ADR 0054): the queue to request one and the bucket to
    // serve signed downloads from. Both absent when unconfigured.
    readonly WORKSPACE_EXPORT_QUEUE?: WorkspaceExportQueueBinding
    readonly WORKSPACE_EXPORT_BUCKET?: WorkspaceExportBucketBinding
  }

// Capability env: the D1 binding selects Live vs Seed, and the webhook queue
// binding enables real fan-out. The projection lives beside `StarterEnv` in
// the capabilities package; this re-export keeps the local import path stable.
export { starterEnv }
