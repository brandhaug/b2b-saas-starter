import { Context, type Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type ListPageInput, type Page } from '../internal/keyset-cursor.ts'

export const ConversationDirectoryEntry = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  creatorUserId: Schema.String,
  requiredPermissions: Schema.Array(Schema.String),
  policyRevision: Schema.Number,
  runAccessRevision: Schema.Number,
  createdAt: Schema.String,
  deletedAt: Schema.NullOr(Schema.String),
  cleanedAt: Schema.NullOr(Schema.String)
})
export type ConversationDirectoryEntry = typeof ConversationDirectoryEntry.Type
export type ConversationOwner = {
  readonly workspaceId: string
  readonly creatorUserId: string
}
export type ConversationDeletionScope =
  | { readonly conversationId: string }
  | { readonly workspaceId: string; readonly creatorUserId?: string }
  | { readonly creatorUserId: string }

export type AssistantDirectoryInterface = {
  readonly create: (
    input: ConversationOwner & { readonly id: string }
  ) => Effect.Effect<ConversationDirectoryEntry, CapabilityUnavailable>
  /** Internal metadata includes fences. Callers must refuse deleted rows before any object invocation. */
  readonly get: (
    id: string
  ) => Effect.Effect<ConversationDirectoryEntry | null, CapabilityUnavailable>
  readonly list: (
    input: ConversationOwner & ListPageInput
  ) => Effect.Effect<Page<ConversationDirectoryEntry>, CapabilityUnavailable>
  readonly listForCreator: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<ConversationDirectoryEntry>, CapabilityUnavailable>
  readonly raisePolicy: (
    id: string,
    permissions: ReadonlyArray<string>
  ) => Effect.Effect<ConversationDirectoryEntry, CapabilityUnavailable>
  readonly policyMatches: (
    id: string,
    revision: number
  ) => Effect.Effect<boolean, CapabilityUnavailable>
  readonly invalidateAccess: (
    scope: ConversationDeletionScope,
    options?: { readonly interruptRuns?: boolean }
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly fence: (
    scope: ConversationDeletionScope
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly pendingCleanup: (
    limit?: number
  ) => Effect.Effect<ReadonlyArray<ConversationDirectoryEntry>, CapabilityUnavailable>
  readonly completeCleanup: (id: string) => Effect.Effect<void, CapabilityUnavailable>
}
export class AssistantDirectory extends Context.Service<
  AssistantDirectory,
  AssistantDirectoryInterface
>()('@b2b-saas-starter/capabilities/AssistantDirectory') {}

export function matchesDeletionScope(
  row: ConversationDirectoryEntry,
  scope: ConversationDeletionScope
): boolean {
  if ('conversationId' in scope) {
    return row.id === scope.conversationId
  }
  if ('workspaceId' in scope) {
    return (
      row.workspaceId === scope.workspaceId &&
      (scope.creatorUserId === undefined || row.creatorUserId === scope.creatorUserId)
    )
  }
  return row.creatorUserId === scope.creatorUserId
}

export type ConversationInvalidationBinding = (
  addresses: ReadonlyArray<
    Pick<ConversationDirectoryEntry, 'id' | 'workspaceId' | 'creatorUserId'>
  >
) => Promise<void>
