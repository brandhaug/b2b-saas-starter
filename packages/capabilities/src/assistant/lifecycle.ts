import { annotateWideEvent } from '@b2b-saas-starter/logger'
import { Context, Effect, Layer, Schema, Result } from 'effect'
import {
  CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { AssistantDirectory } from './directory.ts'

export const ConversationExportManifest = Schema.Array(
  Schema.Struct({ id: Schema.String, policyRevision: Schema.Number })
)
export type ConversationExportManifest = typeof ConversationExportManifest.Type
export const ExportedConversation = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  history: Schema.Json
})
export type ExportedConversation = typeof ExportedConversation.Type

type ExportAuthority = {
  readonly conversationId: string
  readonly workspaceId: string
  readonly creatorUserId: string
  readonly userId: string
  readonly sessionId: string
  readonly policyRevision: number
}
/** The host revalidates current identity, membership, permissions and assurance before returning content. */
export type AssistantLifecycleBinding = {
  readonly exportConversation: (
    input: ExportAuthority
  ) => Promise<{ readonly json: string }>
  readonly revalidateConversation: (input: ExportAuthority) => Promise<boolean>
  readonly destroyConversation: (input: {
    readonly conversationId: string
    readonly workspaceId: string
    readonly creatorUserId: string
  }) => Promise<void>
}
type AssistantConversationLifecycleInterface = {
  readonly collectForExport: (
    userId: string,
    sessionId: string
  ) => Effect.Effect<
    {
      readonly conversations: ReadonlyArray<ExportedConversation>
      readonly manifest: ConversationExportManifest
    },
    CapabilityUnavailable
  >
  readonly validateExport: (
    userId: string,
    sessionId: string,
    manifest: ConversationExportManifest
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly deleteOwned: (
    userId: string,
    conversationId: string
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly cleanup: (limit?: number) => Effect.Effect<number, CapabilityUnavailable>
}
export class AssistantConversationLifecycle extends Context.Service<
  AssistantConversationLifecycle,
  AssistantConversationLifecycleInterface
>()('@b2b-saas-starter/capabilities/AssistantConversationLifecycle') {}

const decodeHistory = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))

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
          userId: string,
          sessionId: string,
          manifest: ConversationExportManifest
        ) {
          for (const entry of manifest) {
            const row = yield* directory.get(entry.id)
            if (
              !row ||
              row.deletedAt ||
              row.creatorUserId !== userId ||
              row.policyRevision !== entry.policyRevision
            ) {
              return yield* new CapabilityUnavailable({
                capability: 'personal-data-export',
                reason: 'conversation_manifest_stale'
              })
            }
            const host = yield* requireHost()
            const authorized = yield* unavailable(
              Effect.tryPromise(() =>
                host.revalidateConversation({
                  conversationId: row.id,
                  workspaceId: row.workspaceId,
                  creatorUserId: row.creatorUserId,
                  userId,
                  sessionId,
                  policyRevision: entry.policyRevision
                })
              )
            )
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
                !(yield* unavailable(
                  Effect.tryPromise(() => host.revalidateConversation(authority))
                ))
              ) {
                continue
              }
              const exported = yield* unavailable(
                Effect.tryPromise(() => host.exportConversation(authority))
              )
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
              yield* unavailable(
                Effect.tryPromise(() =>
                  host.destroyConversation({
                    conversationId: row.id,
                    workspaceId: row.workspaceId,
                    creatorUserId: row.creatorUserId
                  })
                )
              )
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
