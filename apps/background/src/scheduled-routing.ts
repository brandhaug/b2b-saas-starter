import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect } from 'effect'

// The cron expressions are single-sourced in `infra/bindings.ts`, which alchemy
// and the wrangler generator read too — the branch below must key off the same
// literal the trigger is declared with.
import {
  billingReconciliationCron,
  notificationDigestCron,
  notificationDigestRetryCron,
  retentionCleanupCron
} from '../../../infra/bindings.ts'
import { reconcileBillingEffect } from './billing-reconciliation.ts'
import { monitorOperationalHealth } from './monitoring.ts'
import { sendDailyDigest } from './notification-digest.ts'
import { runInvocation, type Env } from './queue-consumer.ts'
import { cleanRetention } from './retention.ts'

/** One cron trigger's work and the monitor slug it reports under. */
export type ScheduledRun = {
  readonly monitorSlug: string
  readonly effects: ReadonlyArray<Effect.Effect<void, unknown, never>>
}

/**
 * The work one cron expression selects, with its monitor slug — one match, so
 * a trigger can never report success under another trigger's slug. `undefined`
 * for an expression no branch claims.
 */
export function scheduledRun(
  cron: string,
  env: Env,
  scheduledTime: number
): ScheduledRun | undefined {
  if (cron === notificationDigestCron) {
    return {
      monitorSlug: 'b2b-saas-starter-background-digest',
      effects: [Effect.asVoid(sendDailyDigest(env, scheduledTime))]
    }
  }
  if (cron === notificationDigestRetryCron) {
    return {
      monitorSlug: 'b2b-saas-starter-background-digest-retry',
      effects: [Effect.asVoid(sendDailyDigest(env, scheduledTime))]
    }
  }
  if (cron === retentionCleanupCron) {
    return {
      monitorSlug: 'b2b-saas-starter-background-retention',
      effects: [cleanRetention(env, scheduledTime)]
    }
  }
  if (cron === billingReconciliationCron) {
    return {
      monitorSlug: 'b2b-saas-starter-background-billing-reconciliation',
      effects: [
        reconcileBillingEffect(env, scheduledTime),
        monitorOperationalHealth(env, scheduledTime)
      ]
    }
  }
  return undefined
}

/**
 * The wide event an unrouted tick exits with. Exported beside the entry so a
 * test can read the event without the isolate runtime `skipUnknownCron` runs
 * it in.
 */
export function unknownCronEvent(
  env: Env,
  controller: ScheduledController
): Effect.Effect<void> {
  return withTriggerScope(
    {
      service: 'background',
      event: 'scheduled_unrouted',
      env,
      metadata: { cron: controller.cron, scheduledTime: controller.scheduledTime }
    },
    Effect.annotateLogsScoped({ outcome: 'failed', skipReason: 'unknown_cron' })
  )
}

/**
 * A cron expression this worker declares no work for. Reporting success under
 * some other trigger's monitor would hide the misconfiguration, so the tick
 * exits as its own annotated wide event and no monitor is checked in: the slug
 * and the work come from the one `scheduledRun` match, which found nothing.
 */
export function skipUnknownCron(
  env: Env,
  controller: ScheduledController
): Promise<void> {
  return runInvocation(env, unknownCronEvent(env, controller))
}
