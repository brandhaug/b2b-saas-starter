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
import { describe, expect, it } from 'vite-plus/test'
import { type ApiEnv } from './env.ts'

/**
 * Type-level regression guard for the binding-name parity between
 * `infra/bindings.ts` and `ApiEnv`. The env's keys are now derived from the
 * infra name union (`ApiBindingName`), so these tests pin the union to the
 * binding set the deploy actually binds: a row dropped or renamed in
 * `infra/bindings.ts` stops the `names` array from compiling, a mistyped
 * binding row in `env.ts` stops the round-trip arrows from compiling, and a
 * binding ADDED in infra fails `env.ts` itself, whose mapped env cannot
 * resolve a name with no binding-type row. `pnpm run check` runs all three
 * through `tsc` before vitest ever loads this file.
 */

// The pre-parity hand-written env shape, re-spelled here as the oracle:
// `ApiEnv` must keep matching it key for key and type for type.
type HandWrittenApiEnv = Readonly<
  Partial<Record<ApiRateLimitBindingName, CloudflareRateLimit>>
> &
  Partial<ServerEnv> & {
    readonly DB?: D1Database
    readonly AI?: WorkersAIBinding
    readonly WEBHOOK_QUEUE?: WebhookQueueBinding
    readonly WORKSPACE_EXPORT_QUEUE?: WorkspaceExportQueueBinding
    readonly WORKSPACE_EXPORT_BUCKET?: WorkspaceExportBucketBinding
    readonly NOTIFICATION_EMAIL_QUEUE?: NotificationEmailQueueBinding
  }

describe('ApiEnv binding parity', () => {
  it('derives exactly the binding names the deploy binds', () => {
    // Every literal must be a member of the infra-derived union: drop or
    // rename a row in `infra/bindings.ts` and this array stops compiling.
    const names: ReadonlyArray<ApiBindingName> = [
      'DB',
      'AI',
      'WEBHOOK_QUEUE',
      'NOTIFICATION_EMAIL_QUEUE',
      'WORKSPACE_EXPORT_QUEUE',
      'WORKSPACE_EXPORT_BUCKET',
      'RATE_LIMITER_REST',
      'RATE_LIMITER_REST_WRITE',
      'RATE_LIMITER_ASSISTANT',
      'RATE_LIMITER_MCP'
    ]
    expect(new Set(names).size).toBe(names.length)
  })

  it('satisfies the hand-written env shape it replaced, both directions', () => {
    // Each declaration typechecks only while its parameter env is assignable
    // to the other shape — a mistyped binding row in `env.ts` fails here.
    function handWrittenIntoModern(env: HandWrittenApiEnv): ApiEnv {
      return env
    }
    function modernIntoHandWritten(env: ApiEnv): HandWrittenApiEnv {
      return env
    }
    expect([handWrittenIntoModern, modernIntoHandWritten]).toHaveLength(2)
  })
})
