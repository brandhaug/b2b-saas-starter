import { Context, Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import { operationsNotificationIntents } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'

export type OperationsNotificationWork = {
  readonly id: string
  readonly eventType:
    | 'impersonation-started'
    | 'impersonation-stopped'
    | 'impersonation-expired'
    | 'impersonation-revoked'
  readonly recipientEmail: string
  readonly merchantName: string
  readonly occurredAt: string
  readonly supportReference: string | null
  readonly securityContact: string
  readonly attemptCount: number
  readonly claimedAt: string
}

export class OperationsNotificationOutbox extends Context.Service<
  OperationsNotificationOutbox,
  {
    readonly claim: (
      intentId: string,
      now: string
    ) => Effect.Effect<OperationsNotificationWork | null, CapabilityUnavailable>
    readonly recoverable: (
      now: string,
      limit?: number
    ) => Effect.Effect<readonly string[], CapabilityUnavailable>
    readonly delivered: (
      intentId: string,
      claimedAt: string,
      attemptCount: number,
      deliveredAt: string
    ) => Effect.Effect<void, CapabilityUnavailable>
    readonly failed: (
      intentId: string,
      claimedAt: string,
      attemptCount: number,
      failureCode: string,
      nextAttemptAt: string | null,
      failedAt: string
    ) => Effect.Effect<void, CapabilityUnavailable>
  }
>()('@b2b-saas-starter/capabilities/OperationsNotificationOutbox') {}

type RawD1 = {
  readonly prepare: (query: string) => {
    readonly bind: (...params: readonly unknown[]) => {
      readonly run: () => Promise<{ readonly meta?: { readonly changes?: number } }>
      readonly all: <A>() => Promise<{ readonly results: readonly A[] }>
    }
  }
}

const unavailable = () =>
  new CapabilityUnavailable({
    capability: 'operations-notifications',
    reason: 'Operations notification persistence is unavailable'
  })

export const makeOperationsNotificationOutboxLayer = (
  db: PromiseDrizzleDatabase
): Layer.Layer<OperationsNotificationOutbox> => {
  const raw = db.$client as unknown as RawD1
  const effect = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: unavailable })

  return Layer.succeed(OperationsNotificationOutbox)({
    claim: (intentId, now) =>
      effect(async () => {
        const stale = new Date(Date.parse(now) - 60_000).toISOString()
        const claimed = await raw
          .prepare(
            `UPDATE operations_notification_intents
             SET status = 'processing', claimed_at = ?1, updated_at = ?1
             WHERE id = ?2 AND (
               (status = 'pending' AND available_at <= ?1) OR
               (status = 'failed' AND next_attempt_at IS NOT NULL
                 AND next_attempt_at <= ?1) OR
               (status = 'processing' AND claimed_at < ?3)
             )`
          )
          .bind(now, intentId, stale)
          .run()
        if ((claimed.meta?.changes ?? 0) !== 1) return null
        const [row] = await db
          .select()
          .from(operationsNotificationIntents)
          .where(eq(operationsNotificationIntents.id, intentId))
          .limit(1)
        if (!row) throw unavailable()
        return {
          id: row.id,
          eventType: row.eventType,
          recipientEmail: row.recipientEmail,
          merchantName: row.merchantName,
          occurredAt: row.occurredAt,
          supportReference: row.supportReference,
          securityContact: row.securityContact,
          attemptCount: row.attemptCount,
          claimedAt: now
        }
      }),
    recoverable: (now, limit = 100) =>
      effect(async () => {
        const stale = new Date(Date.parse(now) - 60_000).toISOString()
        const rows = await raw
          .prepare(
            `SELECT id FROM operations_notification_intents
             WHERE (status = 'pending' AND available_at <= ?1)
                OR (status = 'failed' AND next_attempt_at IS NOT NULL
                    AND next_attempt_at <= ?1)
                OR (status = 'processing' AND claimed_at < ?2)
             ORDER BY available_at, id
             LIMIT ?3`
          )
          .bind(now, stale, limit)
          .all<{ readonly id: string }>()
        return rows.results.map((row) => row.id)
      }),
    delivered: (intentId, claimedAt, attemptCount, deliveredAt) =>
      effect(() =>
        raw
          .prepare(
            `UPDATE operations_notification_intents
             SET status = 'delivered', attempt_count = ?1, claimed_at = NULL,
                 next_attempt_at = NULL, failure_code = NULL, delivered_at = ?2,
                 updated_at = ?2
             WHERE id = ?3 AND status = 'processing' AND claimed_at = ?4`
          )
          .bind(attemptCount, deliveredAt, intentId, claimedAt)
          .run()
          .then(() => undefined)
      ),
    failed: (intentId, claimedAt, attemptCount, failureCode, nextAttemptAt, failedAt) =>
      effect(() =>
        raw
          .prepare(
            `UPDATE operations_notification_intents
             SET status = 'failed', attempt_count = ?1, claimed_at = NULL,
                 next_attempt_at = ?2, failure_code = ?3, updated_at = ?4
             WHERE id = ?5 AND status = 'processing' AND claimed_at = ?6`
          )
          .bind(attemptCount, nextAttemptAt, failureCode, failedAt, intentId, claimedAt)
          .run()
          .then(() => undefined)
      )
  })
}
