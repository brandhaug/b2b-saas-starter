import { clampPageLimit } from '../internal/keyset-cursor.ts'
import { Clock, Effect, Layer } from 'effect'
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm'
import {
  assistantConversations,
  assistantReservations as reservations
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import {
  CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import {
  AssistantAdmission,
  AssistantAdmissionRefused,
  ASSISTANT_SHUTDOWN_GRACE_MS
} from './admission.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'

const unavailable = orUnavailable('assistant-admission')
export const LiveAssistantAdmission = Layer.effect(AssistantAdmission)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const mutate = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })
    const get = Effect.fn('AssistantAdmission.get')(function* (id: string) {
      const rows = yield* unavailable(
        db.select().from(reservations).where(eq(reservations.id, id)).limit(1)
      )
      return rows[0]
    })
    return AssistantAdmission.of({
      reserve: Effect.fn('AssistantAdmission.reserve')(function* (input) {
        const now = yield* Clock.currentTimeMillis
        const existing = yield* get(input.id)
        if (existing) {
          if (
            existing.conversationId !== input.conversationId ||
            existing.userId !== input.userId ||
            existing.workspaceId !== input.workspaceId
          ) {
            return yield* new CapabilityUnavailable({
              capability: 'assistant-admission',
              reason: 'reservation_identity_conflict'
            })
          }
          return existing
        }
        if (input.deadline <= now || input.activeLimit < 1 || input.rateLimit < 1) {
          return yield* new CapabilityUnavailable({
            capability: 'assistant-admission',
            reason: 'invalid_reservation'
          })
        }
        // One INSERT SELECT is the shared Member linearization point across all conversation objects.
        const query = {
          sql: `insert into assistant_reservations (id,conversation_id,workspace_id,user_id,created_at,deadline)
          select ?,?,?,?,?,? where exists (select 1 from assistant_conversations where id=? and workspace_id=? and creator_user_id=? and deleted_at is null)
          and (select count(*) from assistant_reservations where workspace_id=? and user_id=? and released_at is null and deadline>?) < ?
          and (select count(*) from assistant_reservations where workspace_id=? and user_id=? and created_at>?) < ?
          on conflict(id) do nothing`,
          params: [
            input.id,
            input.conversationId,
            input.workspaceId,
            input.userId,
            now,
            input.deadline,
            input.conversationId,
            input.workspaceId,
            input.userId,
            input.workspaceId,
            input.userId,
            now - ASSISTANT_SHUTDOWN_GRACE_MS,
            input.activeLimit,
            input.workspaceId,
            input.userId,
            now - 60_000,
            input.rateLimit
          ]
        }
        const condition = sql`changes() > 0`
        yield* mutate({
          matched: Effect.succeed(true),
          auditEvent: {
            eventType: 'assistant_attempt.reserved',
            targetType: 'assistant_attempt',
            targetId: input.id,
            actorType: 'user',
            actorUserId: input.userId,
            metadata: {
              conversationId: input.conversationId,
              workspaceId: input.workspaceId
            }
          },
          write: () => [{ toSQL: () => query }],
          transition: { condition, alongside: [] }
        })
        const row = yield* get(input.id)
        if (row) {
          return row
        }
        const directories = yield* unavailable(
          db
            .select({ id: assistantConversations.id })
            .from(assistantConversations)
            .where(
              and(
                eq(assistantConversations.id, input.conversationId),
                eq(assistantConversations.workspaceId, input.workspaceId),
                eq(assistantConversations.creatorUserId, input.userId),
                isNull(assistantConversations.deletedAt)
              )
            )
            .limit(1)
        )
        if (!directories[0]) {
          return yield* new CapabilityUnavailable({
            capability: 'assistant-admission',
            reason: 'conversation_not_found'
          })
        }
        const member = yield* unavailable(
          db
            .select()
            .from(reservations)
            .where(
              and(
                eq(reservations.workspaceId, input.workspaceId),
                eq(reservations.userId, input.userId),
                sql`(${reservations.createdAt} > ${now - 60_000} or (${reservations.releasedAt} is null and ${reservations.deadline} > ${now - ASSISTANT_SHUTDOWN_GRACE_MS}))`
              )
            )
        )
        const active = member.filter(
          (entry) =>
            entry.releasedAt === null &&
            entry.deadline + ASSISTANT_SHUTDOWN_GRACE_MS > now
        )
        if (active.length >= input.activeLimit) {
          return yield* new AssistantAdmissionRefused({
            reason: 'concurrency_limit',
            retryAfterSeconds: Math.max(
              1,
              Math.ceil(
                (Math.min(...active.map((entry) => entry.deadline)) +
                  ASSISTANT_SHUTDOWN_GRACE_MS -
                  now) /
                  1000
              )
            )
          })
        }
        return yield* new AssistantAdmissionRefused({
          reason: 'generation_rate_limit',
          retryAfterSeconds: 60
        })
      }),
      commit: Effect.fn('AssistantAdmission.commit')(function* (id) {
        const now = yield* Clock.currentTimeMillis
        yield* mutate({
          matched: get(id).pipe(
            Effect.map(
              (row) =>
                row?.committedAt === null &&
                row.releasedAt === null &&
                row.deadline > now
            )
          ),
          auditEvent: {
            eventType: 'assistant_attempt.committed',
            targetType: 'assistant_attempt',
            targetId: id,
            actorType: 'system',
            metadata: {}
          },
          transition: { condition: sql`changes() > 0`, alongside: [] },
          write: () => [
            db
              .update(reservations)
              .set({ committedAt: now })
              .where(
                and(
                  eq(reservations.id, id),
                  isNull(reservations.committedAt),
                  isNull(reservations.releasedAt),
                  gt(reservations.deadline, now)
                )
              )
          ]
        })
        const row = yield* get(id)
        if (row?.releasedAt !== null || row.deadline <= now) {
          return yield* new CapabilityUnavailable({
            capability: 'assistant-admission',
            reason: 'reservation_expired'
          })
        }
      }),
      reconcileExpired: Effect.fn('AssistantAdmission.reconcileExpired')(function* (
        limit = 100
      ) {
        const now = yield* Clock.currentTimeMillis
        const rows = yield* unavailable(
          db
            .select({ id: reservations.id })
            .from(reservations)
            .where(
              and(
                isNull(reservations.releasedAt),
                lte(reservations.deadline, now - ASSISTANT_SHUTDOWN_GRACE_MS)
              )
            )
            .limit(clampPageLimit(limit))
        )
        if (rows.length === 0) {
          return 0
        }
        const changed = yield* Effect.forEach(rows, (row) =>
          mutate({
            matched: Effect.succeed(true),
            auditEvent: {
              eventType: 'assistant_attempt.released',
              targetType: 'assistant_attempt',
              targetId: row.id,
              actorType: 'system',
              metadata: { action: 'expired' }
            },
            write: () => [
              db
                .update(reservations)
                .set({ releasedAt: now })
                .where(
                  and(
                    eq(reservations.id, row.id),
                    isNull(reservations.releasedAt),
                    lte(reservations.deadline, now - ASSISTANT_SHUTDOWN_GRACE_MS)
                  )
                )
            ],
            transition: { condition: sql`changes() > 0`, alongside: [] }
          })
        )
        return changed.filter(Boolean).length
      }),
      release: Effect.fn('AssistantAdmission.release')(function* (id) {
        const now = yield* Clock.currentTimeMillis
        yield* mutate({
          matched: get(id).pipe(Effect.map((row) => row?.releasedAt === null)),
          auditEvent: {
            eventType: 'assistant_attempt.released',
            targetType: 'assistant_attempt',
            targetId: id,
            actorType: 'system',
            metadata: {}
          },
          transition: { condition: sql`changes() > 0`, alongside: [] },
          write: () => [
            db
              .update(reservations)
              .set({ releasedAt: now })
              .where(and(eq(reservations.id, id), isNull(reservations.releasedAt)))
          ]
        })
      })
    })
  })
)
