import { billingNotices } from '@b2b-saas-starter/db/schema/billing'
import { workspaceMembers } from '@b2b-saas-starter/db/schema/workspaces'
import { Database, type BatchStatement } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Result } from 'effect'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { AuditEventLog, NotificationFeed } from './ports.ts'
import { billingStoreUnavailable, type SubscriptionState } from './billing.ts'
import { lifecycleNotices } from './billing-notices.ts'

export const makeBillingNotices = Effect.fn('Billing.makeNotices')(function* () {
  const db = yield* Database
  const audit = yield* AuditEventLog
  const feed = yield* NotificationFeed
  const prepare = Effect.fn('Billing.prepareNotices')(function* (
    workspaceId: string,
    previous: SubscriptionState | null,
    next: SubscriptionState,
    now: string
  ) {
    const statements: Array<BatchStatement> = []
    for (const notice of lifecycleNotices(previous, next, now)) {
      const id = `${workspaceId}:${notice.key}`
      const existing = yield* billingStoreUnavailable(
        db
          .select({ id: billingNotices.id })
          .from(billingNotices)
          .where(eq(billingNotices.id, id))
          .limit(1)
      )
      if (existing.length !== 0) {
        continue
      }
      statements.push(
        db
          .insert(billingNotices)
          .values({
            id,
            workspaceId,
            noticeType: notice.type,
            title: notice.title,
            message: notice.message,
            createdAt: now
          })
          .onConflictDoNothing(),
        yield* audit.prepareRecord({
          workspaceId,
          actorUserId: null,
          actorType: 'system',
          eventType: `billing.${notice.type}`,
          targetType: 'workspace',
          targetId: workspaceId,
          metadata: { noticeId: id, graceEndsAt: next.graceEndsAt }
        })
      )
    }
    return statements
  })
  const deliver = Effect.fn('Billing.deliverNotices')(function* (workspaceId: string) {
    const [pending, recipients] = yield* Effect.all(
      [
        billingStoreUnavailable(
          db
            .select()
            .from(billingNotices)
            .where(
              and(
                eq(billingNotices.workspaceId, workspaceId),
                isNull(billingNotices.deliveredAt)
              )
            )
        ),
        billingStoreUnavailable(
          db
            .select({ userId: workspaceMembers.userId })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, workspaceId),
                inArray(workspaceMembers.role, ['owner', 'admin'])
              )
            )
        )
      ],
      { concurrency: 2 }
    )
    const recipientIds = [...new Set(recipients.map((recipient) => recipient.userId))]
    for (const notice of pending) {
      // Let every recipient finish persistence and enqueue before reporting a failure.
      const outcomes = yield* Effect.forEach(
        recipientIds,
        (userId) =>
          feed
            .create({
              workspaceId,
              userId,
              deduplicationKey: notice.id,
              kind: 'billing.plan_changed',
              title: notice.title,
              message: notice.message
            })
            .pipe(Effect.result),
        { concurrency: 4 }
      )
      for (const outcome of outcomes) {
        if (Result.isFailure(outcome)) {
          return yield* Effect.fail(outcome.failure)
        }
      }
      yield* billingStoreUnavailable(
        db
          .update(billingNotices)
          .set({ deliveredAt: DateTime.formatIso(yield* DateTime.now) })
          .where(eq(billingNotices.id, notice.id))
      )
    }
  })
  return { prepare, deliver }
})
