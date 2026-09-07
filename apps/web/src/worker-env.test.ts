import {
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type NotificationEmailQueueBinding } from '@b2b-saas-starter/capabilities/notifications/notification-email-queue'
import { type SeatSyncQueueBinding } from '@b2b-saas-starter/billing/seat-sync'
import { type SendEmailBinding } from '@b2b-saas-starter/email'
import { type ServerEnv } from '@b2b-saas-starter/env/server'
import { type WorkersAIBinding } from '@b2b-saas-starter/ai'
import {
  type WebBindingName,
  type WebRateLimitBindingName
} from '@b2b-saas-starter/infra'
import { type CloudflareRateLimit } from '@b2b-saas-starter/rate-limit'
import { describe, expect, it } from 'vite-plus/test'

/**
 * Type-level regression guard for the binding-name parity between
 * `infra/bindings.ts` and the web worker's env (`WebWorkerEnv`, reached here
 * through the ambient `Env` interface `worker-env.d.ts` declares). The env's
 * keys are now derived from the infra name union (`WebBindingName`), so these
 * tests pin the union to the binding set the deploy actually binds: a row
 * dropped or renamed in `infra/bindings.ts` stops the `names` array from
 * compiling, a mistyped binding row in `worker-env.d.ts` stops the round-trip
 * arrows from compiling, and a binding ADDED in infra fails the `.d.ts`
 * itself, whose mapped env cannot resolve a name with no binding-type row.
 * `pnpm run check` runs all three through `tsc` before vitest ever loads
 * this file.
 */

// The pre-parity hand-written env shape, re-spelled here as the oracle: the
// ambient `Env` must keep matching it key for key and type for type.
type RateLimitAuthBindings = Readonly<
  Partial<Record<WebRateLimitBindingName, CloudflareRateLimit>>
>

type HandWrittenWebWorkerEnv = {
  readonly DB?: D1Database
  readonly NOTIFICATION_EMAIL_QUEUE?: NotificationEmailQueueBinding
  readonly EMAIL?: SendEmailBinding
  readonly AI?: WorkersAIBinding
  readonly WORKSPACE_EXPORT_QUEUE?: WorkspaceExportQueueBinding
  readonly WORKSPACE_EXPORT_BUCKET?: WorkspaceExportBucketBinding
  readonly BILLING_QUEUE?: SeatSyncQueueBinding
} & RateLimitAuthBindings &
  Readonly<ServerEnv>

describe('web worker env binding parity', () => {
  it('derives exactly the binding names the deploy binds', () => {
    // Every literal must be a member of the infra-derived union: drop or
    // rename a row in `infra/bindings.ts` and this array stops compiling.
    const names: ReadonlyArray<WebBindingName> = [
      'DB',
      'NOTIFICATION_EMAIL_QUEUE',
      'EMAIL',
      'AI',
      'WORKSPACE_EXPORT_QUEUE',
      'WORKSPACE_EXPORT_BUCKET',
      'BILLING_QUEUE',
      'RATE_LIMITER_AUTH_READ',
      'RATE_LIMITER_AUTH_WRITE',
      'RATE_LIMITER_AUTH_SIGN_IN'
    ]
    expect(new Set(names).size).toBe(names.length)
  })

  it('satisfies the hand-written env shape it replaced, both directions', () => {
    // Each declaration typechecks only while its parameter env is assignable
    // to the other shape — a mistyped binding row in `worker-env.d.ts` fails
    // here.
    function handWrittenIntoModern(env: HandWrittenWebWorkerEnv): Env {
      return env
    }
    function modernIntoHandWritten(env: Env): HandWrittenWebWorkerEnv {
      return env
    }
    expect([handWrittenIntoModern, modernIntoHandWritten]).toHaveLength(2)
  })
})
