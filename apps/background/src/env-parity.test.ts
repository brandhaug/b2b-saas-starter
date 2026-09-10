import {
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type NotificationEmailQueueBinding } from '@b2b-saas-starter/capabilities/notifications/notification-email-queue'
import { type WebhookQueueBinding } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import { type SendEmailBinding } from '@b2b-saas-starter/email'
import { type ServerEnv } from '@b2b-saas-starter/env/server'
import { type BackgroundBindingName } from '@b2b-saas-starter/infra'
import { describe, expectTypeOf, it } from 'vite-plus/test'
import { type Env } from './queue-consumer.ts'

/**
 * Type-level regression guard for the binding-name parity between
 * `infra/bindings.ts` and the background worker's `Env`. The env's keys are
 * now derived from the infra name union (`BackgroundBindingName`), so these
 * tests pin the union to the binding set the deploy actually binds: a row
 * dropped or renamed in `infra/bindings.ts` stops the `names` array from
 * compiling, a mistyped binding row in `queue-consumer.ts` stops the
 * round-trip arrows from compiling, and a binding ADDED in infra fails
 * `queue-consumer.ts` itself, whose mapped env cannot resolve a name with no
 * binding-type row. `pnpm run check` runs all three through `tsc` before
 * vitest ever loads this file.
 */

// The pre-parity hand-written env shape, re-spelled here as the oracle:
// `Env` must keep matching it key for key and type for type.
type HandWrittenEnv = Partial<ServerEnv> & {
  readonly DB?: D1Database
  readonly WEBHOOK_QUEUE?: WebhookQueueBinding
  readonly WORKSPACE_EXPORT_QUEUE?: WorkspaceExportQueueBinding
  readonly WORKSPACE_EXPORT_BUCKET?: WorkspaceExportBucketBinding
  readonly NOTIFICATION_EMAIL_QUEUE?: NotificationEmailQueueBinding
  readonly EMAIL?: SendEmailBinding
}

/** The binding names the deploy binds, re-spelled here as the oracle. */
type DeclaredBindingName =
  | 'DB'
  | 'WEBHOOK_QUEUE'
  | 'BILLING_QUEUE'
  | 'WORKSPACE_EXPORT_QUEUE'
  | 'WORKSPACE_EXPORT_BUCKET'
  | 'NOTIFICATION_EMAIL_QUEUE'
  | 'EMAIL'

describe('background Env binding parity', () => {
  // Type-level, not runtime: nothing here can be observed at runtime, so the
  // assertions are the ones `tsc` checks. A row dropped, renamed or added in
  // `infra/bindings.ts` fails the first; a mistyped binding row in
  // `queue-consumer.ts` fails the second, in whichever direction drifted.
  it('derives exactly the binding names the deploy binds', () => {
    expectTypeOf<BackgroundBindingName>().toEqualTypeOf<DeclaredBindingName>()
  })

  it('satisfies the hand-written env shape it replaced, both directions', () => {
    expectTypeOf<HandWrittenEnv>().toExtend<Env>()
    expectTypeOf<Env>().toExtend<HandWrittenEnv>()
  })
})
