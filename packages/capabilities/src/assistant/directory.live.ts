import { annotateWideEvent } from '@b2b-saas-starter/logger'
import {
  recordSecurityEvidence,
  type SecurityEvidenceSink
} from '../governance/security-recovery-evidence.ts'
import { Clock, Effect, Layer, Schema } from 'effect'
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  assistantConversations as conversations,
  assistantReservations,
  personalDataExports
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import {
  CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import {
  AssistantDirectory,
  type ConversationDeletionScope,
  type ConversationInvalidationBinding
} from './directory.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import { clampPageLimit, cutKeysetPage } from '../internal/keyset-cursor.ts'
import { keysetResume } from '../internal/keyset-query.ts'
import { iso } from '../internal/timestamps.ts'

const encodePermissions = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.String))
)
const unavailable = orUnavailable('assistant-directory')
function scopeCondition(scope: ConversationDeletionScope) {
  if ('conversationId' in scope) {
    return eq(conversations.id, scope.conversationId)
  }
  if ('workspaceId' in scope) {
    if (scope.creatorUserId === undefined) {
      return eq(conversations.workspaceId, scope.workspaceId)
    }
    return and(
      eq(conversations.workspaceId, scope.workspaceId),
      eq(conversations.creatorUserId, scope.creatorUserId)
    )
  }
  return eq(conversations.creatorUserId, scope.creatorUserId)
}

export function LiveAssistantDirectory(
  securityEvidence?: SecurityEvidenceSink,
  notify?: ConversationInvalidationBinding
) {
  return Layer.effect(AssistantDirectory)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const mutate = yield* auditedMutations({
        prepareAuditRecord: audit.prepareRecord,
        unavailable
      })
      const get = Effect.fn('AssistantDirectory.get')(function* (id: string) {
        const rows = yield* unavailable(
          db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
        )
        return rows[0] ?? null
      })
      const invalidateHosts = Effect.fn('AssistantDirectory.invalidateHosts')(
        function* (scope: ConversationDeletionScope) {
          if (notify === undefined) {
            return
          }
          const rows = yield* unavailable(
            db.select().from(conversations).where(scopeCondition(scope))
          )
          yield* Effect.tryPromise(() => notify(rows)).pipe(
            Effect.catch(() =>
              annotateWideEvent({
                assistantAuthorityNotification: 'host_unavailable',
                assistantAffectedConversations: rows.length
              })
            )
          )
        }
      )
      return AssistantDirectory.of({
        get,
        create: Effect.fn('AssistantDirectory.create')(function* (input) {
          const now = yield* Clock.currentTimeMillis
          yield* mutate({
            matched: Effect.succeed(true),
            auditEvent: {
              eventType: 'assistant_conversation.created',
              targetType: 'assistant_conversation',
              targetId: input.id,
              actorType: 'user',
              actorUserId: input.creatorUserId,
              metadata: {}
            },
            transition: { condition: sql`changes() > 0`, alongside: [] },
            write: () => [
              db
                .insert(conversations)
                .values({ ...input, createdAt: iso(now) })
                .onConflictDoNothing()
            ]
          })
          const row = yield* get(input.id)
          if (
            !row ||
            row.deletedAt ||
            row.creatorUserId !== input.creatorUserId ||
            row.workspaceId !== input.workspaceId
          ) {
            return yield* new CapabilityUnavailable({
              capability: 'assistant-directory',
              reason: 'conversation_identity_conflict'
            })
          }
          return row
        }),
        list: Effect.fn('AssistantDirectory.list')(function* (input) {
          const resume = keysetResume(
            'desc',
            { key: conversations.createdAt, id: conversations.id },
            input.cursor
          )
          if (resume.kind === 'empty') {
            return { items: [], nextCursor: null }
          }
          const limit = clampPageLimit(input.limit)
          let condition
          if (resume.kind === 'resume') {
            condition = resume.condition
          }
          const rows = yield* unavailable(
            db
              .select()
              .from(conversations)
              .where(
                and(
                  eq(conversations.workspaceId, input.workspaceId),
                  eq(conversations.creatorUserId, input.creatorUserId),
                  isNull(conversations.deletedAt),
                  condition
                )
              )
              .orderBy(desc(conversations.createdAt), desc(conversations.id))
              .limit(limit + 1)
          )
          return cutKeysetPage(rows, limit, (row) => ({
            key: row.createdAt,
            id: row.id
          }))
        }),
        listForCreator: Effect.fn('AssistantDirectory.listForCreator')(
          function* (userId) {
            return yield* unavailable(
              db
                .select()
                .from(conversations)
                .where(
                  and(
                    eq(conversations.creatorUserId, userId),
                    isNull(conversations.deletedAt)
                  )
                )
            )
          }
        ),
        raisePolicy: Effect.fn('AssistantDirectory.raisePolicy')(
          function* (id, permissions) {
            const row = yield* get(id)
            if (!row || row.deletedAt) {
              return yield* new CapabilityUnavailable({
                capability: 'assistant-directory',
                reason: 'conversation_not_found'
              })
            }
            // SQL unions against the current row so concurrent evidence admissions cannot lose a requirement.
            const knownPermissions = new Set(row.requiredPermissions)
            const encodedPermissions = encodePermissions(permissions)
            const additions = sql`exists (select 1 from json_each(${encodedPermissions}) incoming where incoming.value not in (select value from json_each(${conversations.requiredPermissions})))`
            const condition = and(
              eq(conversations.id, id),
              isNull(conversations.deletedAt),
              additions
            )
            yield* mutate({
              matched: Effect.succeed(
                permissions.some((permission) => !knownPermissions.has(permission))
              ),
              auditEvent: {
                eventType: 'assistant_conversation.policy_changed',
                targetType: 'assistant_conversation',
                targetId: id,
                actorType: 'system',
                metadata: {}
              },
              transition: {
                condition: sql`changes() > 0`,
                alongside: [],
                writeIndex: 1
              },
              write: () => [
                db
                  .delete(personalDataExports)
                  .where(
                    and(
                      eq(personalDataExports.userId, row.creatorUserId),
                      sql`exists (select 1 from ${conversations} where ${condition})`
                    )
                  ),
                db
                  .update(conversations)
                  .set({
                    requiredPermissions: sql`(select json_group_array(value) from (select value from json_each(${conversations.requiredPermissions}) union select value from json_each(${encodedPermissions}) order by value))`,
                    policyRevision: sql`${conversations.policyRevision} + 1`
                  })
                  .where(condition)
              ]
            })
            const current = yield* get(id)
            if (!current || current.deletedAt) {
              return yield* new CapabilityUnavailable({
                capability: 'assistant-directory',
                reason: 'conversation_not_found'
              })
            }
            yield* invalidateHosts({ conversationId: id })
            return current
          }
        ),
        policyMatches: Effect.fn('AssistantDirectory.policyMatches')(
          function* (id, revision) {
            const row = yield* get(id)
            return row?.deletedAt === null && row.policyRevision === revision
          }
        ),
        invalidateAccess: Effect.fn('AssistantDirectory.invalidateAccess')(
          function* (scope, options) {
            const condition = scopeCondition(scope)
            yield* mutate({
              matched: Effect.succeed(true),
              auditEvent: {
                eventType: 'assistant_conversation.policy_changed',
                targetType: 'assistant_conversation',
                actorType: 'system',
                metadata: { action: 'access_changed' }
              },
              transition: {
                condition: sql`changes() > 0`,
                alongside: [],
                writeIndex: 1
              },
              write: () => [
                db
                  .delete(personalDataExports)
                  .where(
                    sql`${personalDataExports.userId} in (select ${conversations.creatorUserId} from ${conversations} where ${condition})`
                  ),
                db
                  .update(conversations)
                  .set({
                    policyRevision: sql`${conversations.policyRevision} + 1`,
                    runAccessRevision: sql`${conversations.runAccessRevision} + ${Number(options?.interruptRuns === true)}`
                  })
                  .where(and(condition, isNull(conversations.deletedAt)))
              ]
            })
            yield* invalidateHosts(scope)
          }
        ),
        fence: Effect.fn('AssistantDirectory.fence')(function* (scope) {
          const now = yield* Clock.currentTimeMillis
          const condition = scopeCondition(scope)
          let targetId: string | null = null
          if ('conversationId' in scope) {
            targetId = scope.conversationId
          }
          yield* mutate({
            matched: Effect.succeed(true),
            auditEvent: {
              eventType: 'assistant_conversation.deleted',
              targetType: 'assistant_conversation',
              targetId,
              actorType: 'system',
              metadata: {}
            },
            transition: { condition: sql`changes() > 0`, alongside: [], writeIndex: 2 },
            write: () => [
              db
                .delete(personalDataExports)
                .where(
                  sql`${personalDataExports.userId} in (select ${conversations.creatorUserId} from ${conversations} where ${condition})`
                ),
              db
                .update(assistantReservations)
                .set({ releasedAt: now })
                .where(
                  and(
                    isNull(assistantReservations.releasedAt),
                    sql`${assistantReservations.conversationId} in (select ${conversations.id} from ${conversations} where ${condition})`
                  )
                ),
              db
                .update(conversations)
                .set({
                  deletedAt: iso(now),
                  policyRevision: sql`${conversations.policyRevision} + 1`
                })
                .where(and(condition, isNull(conversations.deletedAt)))
            ]
          })
          yield* invalidateHosts(scope)
          if ('conversationId' in scope) {
            const row = yield* get(scope.conversationId)
            if (row?.deletedAt) {
              yield* recordSecurityEvidence(
                {
                  kind: 'assistant_conversation_deleted',
                  subjectId: row.id,
                  workspaceId: row.workspaceId,
                  creatorUserId: row.creatorUserId
                },
                securityEvidence
              )
            }
          }
        }),
        pendingCleanup: Effect.fn('AssistantDirectory.pendingCleanup')(function* (
          limit = 100
        ) {
          return yield* unavailable(
            db
              .select()
              .from(conversations)
              .where(
                and(isNotNull(conversations.deletedAt), isNull(conversations.cleanedAt))
              )
              .limit(clampPageLimit(limit))
          )
        }),
        completeCleanup: Effect.fn('AssistantDirectory.completeCleanup')(
          function* (id) {
            const now = yield* Clock.currentTimeMillis
            yield* mutate({
              matched: Effect.succeed(true),
              auditEvent: {
                eventType: 'assistant_conversation.deleted',
                targetType: 'assistant_conversation',
                targetId: id,
                actorType: 'system',
                metadata: { action: 'storage_removed' }
              },
              transition: { condition: sql`changes() > 0`, alongside: [] },
              write: () => [
                db
                  .update(conversations)
                  .set({ cleanedAt: iso(now), requiredPermissions: [] })
                  .where(
                    and(
                      eq(conversations.id, id),
                      isNotNull(conversations.deletedAt),
                      isNull(conversations.cleanedAt)
                    )
                  )
              ]
            })
          }
        )
      })
    })
  )
}
