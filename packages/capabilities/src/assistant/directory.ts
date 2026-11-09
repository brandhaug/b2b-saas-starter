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

/**
 * The owner of the `assistant_conversations` tombstone machine (ADR 0077).
 * A conversation is live until the deletion fence writes `deletedAt`; object
 * cleanup then writes `cleanedAt`. Tombstones retain immutable addresses
 * forever — these rows are never cascaded and their IDs never reused — so
 * `cleanedAt` is terminal.
 *
 * Transition evidence is the audit trail: both writes are recorded as
 * `assistant_conversation.deleted`, cleanup with `action: 'storage_removed'`.
 *
 * SQL mirrors that must stay in step, named rather than edited:
 * - `assistant_conversations_cleanup_idx` on (`deleted_at`, `cleaned_at`)
 *   backs the `pendingCleanup` deleted-not-yet-cleaned scan (migration
 *   `20260915114634_friendly_madame_hydra`).
 * - the directory writes in `directory.live.ts` guard the fence with
 *   `deleted_at is null` and cleanup with `deleted_at is not null and
 *   cleaned_at is null`; the admission reserve INSERT in `admission.live.ts`
 *   requires `deleted_at is null`.
 */
export type ConversationLifecycleStatus = 'live' | 'deleted' | 'cleaned'

/** The evidence that moves a tombstone; each write is audited as named above. */
export type ConversationLifecycleEvent =
  | { readonly kind: 'fenced' }
  | { readonly kind: 'cleaned' }

const conversationLifecycleTransitions = {
  live: { fenced: 'deleted', cleaned: null },
  deleted: { fenced: null, cleaned: 'cleaned' },
  cleaned: { fenced: null, cleaned: null }
} as const satisfies Record<
  ConversationLifecycleStatus,
  Record<ConversationLifecycleEvent['kind'], ConversationLifecycleStatus | null>
>

/** Derives the tombstone state from the stored timestamps. */
export function conversationLifecycleStatus(
  entry: Pick<ConversationDirectoryEntry, 'deletedAt' | 'cleanedAt'>
): ConversationLifecycleStatus {
  if (entry.cleanedAt !== null) {
    return 'cleaned'
  }
  if (entry.deletedAt !== null) {
    return 'deleted'
  }
  return 'live'
}

/**
 * Applies one event; `null` refuses it. Only a live row can fence and only a
 * deleted-not-cleaned row can clean, so no write ever rewrites a timestamp.
 */
export function nextConversationLifecycleStatus(
  status: ConversationLifecycleStatus,
  event: ConversationLifecycleEvent
): ConversationLifecycleStatus | null {
  return conversationLifecycleTransitions[status][event.kind]
}

/** Whether the conversation is visible: no deletion fence has been written. */
export function isLiveConversation(
  entry: Pick<ConversationDirectoryEntry, 'deletedAt'>
): boolean {
  return entry.deletedAt === null
}

/** Whether the deletion fence has been written; cleaned tombstones stay deleted. */
export function isDeletedConversation(
  entry: Pick<ConversationDirectoryEntry, 'deletedAt'>
): boolean {
  return entry.deletedAt !== null
}

/** Whether object cleanup has completed; the terminal tombstone state. */
export function isCleanedConversation(
  entry: Pick<ConversationDirectoryEntry, 'cleanedAt'>
): boolean {
  return entry.cleanedAt !== null
}
