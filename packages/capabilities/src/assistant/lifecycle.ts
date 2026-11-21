import { type UserId, WorkspaceId } from '@b2b-saas-starter/db/ids'
import { narrowFailure } from '@b2b-saas-starter/failure/narrowing'
import { annotateWideEvent } from '@b2b-saas-starter/logger'
import { Context, Effect, Layer, Schema, Result } from 'effect'
import {
  CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { type ConversationUnavailable } from '../developer-platform/assistant-conversation.ts'
import { AssistantDirectory, isDeletedConversation } from './directory.ts'

export const ConversationExportManifest = Schema.Array(
  Schema.Struct({ id: Schema.String, policyRevision: Schema.Finite })
)
export type ConversationExportManifest = typeof ConversationExportManifest.Type
export const ExportedConversation = Schema.Struct({
  id: Schema.String,
  workspaceId: WorkspaceId,
  history: Schema.Json
})
export type ExportedConversation = typeof ExportedConversation.Type

export type ExportAuthority = {
  readonly conversationId: string
  readonly workspaceId: WorkspaceId
  readonly creatorUserId: UserId
  readonly userId: UserId
  readonly sessionId: string
  readonly policyRevision: number
}
/**
 * The host revalidates current identity, membership, permissions and assurance
 * before returning content. Calls compose into the caller's fiber, so its span,
 * interruption and typed host failure reach the lifecycle operation.
 */
export type AssistantLifecycleBinding = {
  readonly exportConversation: (
    input: ExportAuthority
  ) => Effect.Effect<{ readonly json: string }, ConversationUnavailable>
  readonly revalidateConversation: (
    input: ExportAuthority
  ) => Effect.Effect<boolean, ConversationUnavailable>
  readonly destroyConversation: (input: {
    readonly conversationId: string
    readonly workspaceId: WorkspaceId
    readonly creatorUserId: UserId
  }) => Effect.Effect<void, ConversationUnavailable>
}
type AssistantConversationLifecycleInterface = {
  readonly collectForExport: (
    userId: UserId,
    sessionId: string
  ) => Effect.Effect<
    {
      readonly conversations: ReadonlyArray<ExportedConversation>
      readonly manifest: ConversationExportManifest
    },
    CapabilityUnavailable
  >
  readonly validateExport: (
    userId: UserId,
    sessionId: string,
    manifest: ConversationExportManifest
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly deleteOwned: (
    userId: UserId,
    conversationId: string
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly cleanup: (limit?: number) => Effect.Effect<number, CapabilityUnavailable>
}
export class AssistantConversationLifecycle extends Context.Service<
  AssistantConversationLifecycle,
  AssistantConversationLifecycleInterface
>()('@b2b-saas-starter/capabilities/AssistantConversationLifecycle') {}

const decodeHistory = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))

/** A host failure keeps its typed reason on the lifecycle's unavailable error. */
function hostUnavailable(error: ConversationUnavailable): CapabilityUnavailable {
  return new CapabilityUnavailable({
    capability: 'assistant-lifecycle',
    reason: `conversation_host_${error.reason}`
  })
}

export function AssistantConversationLifecycleLayer(
  binding?: AssistantLifecycleBinding
) {
  return Layer.effect(AssistantConversationLifecycle)(
    Effect.gen(function* () {
      const directory = yield* AssistantDirectory
      const unavailable = orUnavailable('assistant-lifecycle')
      const requireHost = Effect.fn('AssistantConversationLifecycle.requireHost')(
        function* () {
          if (!binding) {
            return yield* new CapabilityUnavailable({
              capability: 'assistant-lifecycle',
              reason: 'conversation_host_unconfigured'
            })
          }
          return binding
        }
      )
      const validateExport = Effect.fn('AssistantConversationLifecycle.validateExport')(
        function* (
          userId: UserId,
          sessionId: string,
          manifest: ConversationExportManifest
        ) {
          for (const entry of manifest) {
            const row = yield* directory.get(entry.id)
            if (
              !row ||
              isDeletedConversation(row) ||
              row.creatorUserId !== userId ||
              row.policyRevision !== entry.policyRevision
            ) {
              return yield* new CapabilityUnavailable({
                capability: 'personal-data-export',
                reason: 'conversation_manifest_stale'
              })
            }
            const host = yield* requireHost()
            const authorized = yield* host
              .revalidateConversation({
                conversationId: row.id,
                workspaceId: row.workspaceId,
                creatorUserId: row.creatorUserId,
                userId,
                sessionId,
                policyRevision: entry.policyRevision
              })
              .pipe(narrowFailure(hostUnavailable))
            if (
              !authorized ||
              !(yield* directory.policyMatches(row.id, entry.policyRevision))
            ) {
              return yield* new CapabilityUnavailable({
                capability: 'personal-data-export',
                reason: 'conversation_access_lost'
              })
            }
          }
        }
      )
      return AssistantConversationLifecycle.of({
        validateExport,
        collectForExport: Effect.fn('AssistantConversationLifecycle.collectForExport')(
          function* (userId, sessionId) {
            const rows = yield* directory.listForCreator(userId)
            const conversations: Array<ExportedConversation> = []
            const manifest: Array<ConversationExportManifest[number]> = []
            for (const row of rows) {
              const host = yield* requireHost()
              const authority = {
                conversationId: row.id,
                workspaceId: row.workspaceId,
                creatorUserId: row.creatorUserId,
                userId,
                sessionId,
                policyRevision: row.policyRevision
              }
              if (
                !(yield* host
                  .revalidateConversation(authority)
                  .pipe(narrowFailure(hostUnavailable)))
              ) {
                continue
              }
              const exported = yield* host
                .exportConversation(authority)
                .pipe(narrowFailure(hostUnavailable))
              const history = yield* unavailable(decodeHistory(exported.json))
              conversations.push({ id: row.id, workspaceId: row.workspaceId, history })
              manifest.push({ id: row.id, policyRevision: row.policyRevision })
            }
            yield* validateExport(userId, sessionId, manifest)
            return { conversations, manifest }
          }
        ),
        deleteOwned: Effect.fn('AssistantConversationLifecycle.deleteOwned')(
          function* (userId, conversationId) {
            const row = yield* directory.get(conversationId)
            // Opaque and content-free, including after membership loss.
            if (!row || row.creatorUserId !== userId) {
              return
            }
            yield* directory.fence({ conversationId })
          }
        ),
        cleanup: Effect.fn('AssistantConversationLifecycle.cleanup')(function* (limit) {
          const rows = yield* directory.pendingCleanup(limit)
          let failed = 0
          for (const row of rows) {
            const result = yield* Effect.gen(function* () {
              const host = yield* requireHost()
              yield* host
                .destroyConversation({
                  conversationId: row.id,
                  workspaceId: row.workspaceId,
                  creatorUserId: row.creatorUserId
                })
                .pipe(narrowFailure(hostUnavailable))
              yield* directory.completeCleanup(row.id)
            }).pipe(Effect.result)
            if (Result.isFailure(result)) {
              failed += 1
            }
          }
          yield* annotateWideEvent({ failedConversations: failed })
          if (failed > 0) {
            return yield* new CapabilityUnavailable({
              capability: 'assistant-lifecycle',
              reason: 'conversation_cleanup_incomplete'
            })
          }
          return rows.length
        })
      })
    })
  )
}
