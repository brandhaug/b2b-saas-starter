import { Clock, Effect, Layer } from 'effect'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import {
  AssistantDirectory,
  type ConversationDirectoryEntry,
  matchesDeletionScope
} from './directory.ts'
import { seedKeysetPage } from '../internal/keyset-cursor.ts'
import { iso } from '../internal/timestamps.ts'

export const SeedAssistantDirectory = Layer.sync(AssistantDirectory)(() => {
  const rows = new Map<string, ConversationDirectoryEntry>()
  const get = Effect.fn('AssistantDirectory.get')(function* (id: string) {
    return yield* Effect.sync(() => rows.get(id) ?? null)
  })
  return AssistantDirectory.of({
    get,
    create: Effect.fn('AssistantDirectory.create')(function* (input) {
      const now = yield* Clock.currentTimeMillis
      const existing = rows.get(input.id)
      if (existing) {
        if (
          existing.deletedAt ||
          existing.workspaceId !== input.workspaceId ||
          existing.creatorUserId !== input.creatorUserId
        ) {
          return yield* new CapabilityUnavailable({
            capability: 'assistant-directory',
            reason: 'conversation_identity_conflict'
          })
        }
        return existing
      }
      const row = {
        ...input,
        requiredPermissions: [],
        policyRevision: 0,
        runAccessRevision: 0,
        createdAt: iso(now),
        deletedAt: null,
        cleanedAt: null
      }
      rows.set(row.id, row)
      return row
    }),
    list: Effect.fn('AssistantDirectory.list')(function* (input) {
      return yield* Effect.sync(() =>
        seedKeysetPage(
          [...rows.values()].filter(
            (row) =>
              !row.deletedAt &&
              row.workspaceId === input.workspaceId &&
              row.creatorUserId === input.creatorUserId
          ),
          'desc',
          (row) => ({ key: row.createdAt, id: row.id }),
          input
        )
      )
    }),
    listForCreator: Effect.fn('AssistantDirectory.listForCreator')(function* (userId) {
      return yield* Effect.sync(() =>
        [...rows.values()].filter(
          (row) => !row.deletedAt && row.creatorUserId === userId
        )
      )
    }),
    raisePolicy: Effect.fn('AssistantDirectory.raisePolicy')(
      function* (id, permissions) {
        const row = rows.get(id)
        if (!row || row.deletedAt) {
          return yield* new CapabilityUnavailable({
            capability: 'assistant-directory',
            reason: 'conversation_not_found'
          })
        }
        const requiredPermissions = [
          ...new Set([...row.requiredPermissions, ...permissions])
        ].toSorted()
        if (requiredPermissions.length === row.requiredPermissions.length) {
          return row
        }
        const next = {
          ...row,
          requiredPermissions,
          policyRevision: row.policyRevision + 1
        }
        rows.set(id, next)
        return next
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
        yield* Effect.sync(() => {
          for (const [id, row] of rows) {
            if (!row.deletedAt && matchesDeletionScope(row, scope)) {
              rows.set(id, {
                ...row,
                policyRevision: row.policyRevision + 1,
                runAccessRevision:
                  row.runAccessRevision + Number(options?.interruptRuns === true)
              })
            }
          }
        })
      }
    ),
    fence: Effect.fn('AssistantDirectory.fence')(function* (scope) {
      const now = yield* Clock.currentTimeMillis
      for (const [id, row] of rows) {
        if (!row.deletedAt && matchesDeletionScope(row, scope)) {
          rows.set(id, {
            ...row,
            deletedAt: iso(now),
            policyRevision: row.policyRevision + 1
          })
        }
      }
    }),
    pendingCleanup: Effect.fn('AssistantDirectory.pendingCleanup')(function* (
      limit = 100
    ) {
      return yield* Effect.sync(() =>
        [...rows.values()]
          .filter((row) => row.deletedAt && !row.cleanedAt)
          .slice(0, limit)
      )
    }),
    completeCleanup: Effect.fn('AssistantDirectory.completeCleanup')(function* (id) {
      const now = yield* Clock.currentTimeMillis
      const row = rows.get(id)
      if (row?.deletedAt) {
        rows.set(id, { ...row, requiredPermissions: [], cleanedAt: iso(now) })
      }
    })
  })
})
