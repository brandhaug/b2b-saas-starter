import { Clock, Effect, Layer } from 'effect'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { AssistantDirectory } from './directory.ts'
import {
  AssistantAdmission,
  AssistantAdmissionRefused,
  ASSISTANT_SHUTDOWN_GRACE_MS,
  type AssistantReservation
} from './admission.ts'

export const SeedAssistantAdmission = Layer.effect(AssistantAdmission)(
  Effect.gen(function* () {
    const directory = yield* AssistantDirectory
    const rows = new Map<string, AssistantReservation>()
    return AssistantAdmission.of({
      reserve: Effect.fn('AssistantAdmission.reserve')(function* (input) {
        const conversation = yield* directory.get(input.conversationId)
        if (
          !conversation ||
          conversation.deletedAt ||
          conversation.workspaceId !== input.workspaceId ||
          conversation.creatorUserId !== input.userId
        ) {
          return yield* new CapabilityUnavailable({
            capability: 'assistant-admission',
            reason: 'conversation_not_found'
          })
        }
        const visible = yield* directory.listForCreator(input.userId)
        const retained = new Set(visible.map((row) => row.id))
        const now = yield* Clock.currentTimeMillis
        const existing = rows.get(input.id)
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
        const member = [...rows.values()].filter(
          (row) => row.workspaceId === input.workspaceId && row.userId === input.userId
        )
        const active = member.filter(
          (row) =>
            row.releasedAt === null &&
            retained.has(row.conversationId) &&
            row.deadline + ASSISTANT_SHUTDOWN_GRACE_MS > now
        )
        if (active.length >= input.activeLimit) {
          return yield* new AssistantAdmissionRefused({
            reason: 'concurrency_limit',
            retryAfterSeconds: Math.max(
              1,
              Math.ceil(
                (Math.min(...active.map((row) => row.deadline)) +
                  ASSISTANT_SHUTDOWN_GRACE_MS -
                  now) /
                  1000
              )
            )
          })
        }
        const recent = member.filter((row) => row.createdAt > now - 60_000)
        if (recent.length >= input.rateLimit) {
          return yield* new AssistantAdmissionRefused({
            reason: 'generation_rate_limit',
            retryAfterSeconds: Math.max(
              1,
              Math.ceil(
                (Math.min(...recent.map((row) => row.createdAt)) + 60_000 - now) / 1000
              )
            )
          })
        }
        const row = {
          id: input.id,
          conversationId: input.conversationId,
          workspaceId: input.workspaceId,
          userId: input.userId,
          deadline: input.deadline,
          createdAt: now,
          committedAt: null,
          releasedAt: null
        }
        rows.set(row.id, row)
        return row
      }),
      commit: Effect.fn('AssistantAdmission.commit')(function* (id) {
        const now = yield* Clock.currentTimeMillis
        const row = rows.get(id)
        if (row?.releasedAt !== null || row.deadline <= now) {
          return yield* new CapabilityUnavailable({
            capability: 'assistant-admission',
            reason: 'reservation_expired'
          })
        }
        const conversation = yield* directory.get(row.conversationId)
        if (!conversation || conversation.deletedAt) {
          return yield* new CapabilityUnavailable({
            capability: 'assistant-admission',
            reason: 'reservation_expired'
          })
        }
        rows.set(id, { ...row, committedAt: row.committedAt ?? now })
      }),
      reconcileExpired: Effect.fn('AssistantAdmission.reconcileExpired')(function* (
        limit = 100
      ) {
        const now = yield* Clock.currentTimeMillis
        let count = 0
        for (const [id, row] of rows) {
          if (count >= limit) {
            break
          }
          if (
            row.releasedAt === null &&
            row.deadline + ASSISTANT_SHUTDOWN_GRACE_MS <= now
          ) {
            rows.set(id, { ...row, releasedAt: now })
            count += 1
          }
        }
        return count
      }),
      release: Effect.fn('AssistantAdmission.release')(function* (id) {
        const now = yield* Clock.currentTimeMillis
        const row = rows.get(id)
        if (row) {
          rows.set(id, { ...row, releasedAt: row.releasedAt ?? now })
        }
      })
    })
  })
)
