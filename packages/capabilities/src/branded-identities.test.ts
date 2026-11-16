import { type UserId, type WorkspaceId } from '@b2b-saas-starter/db/ids'
import { describe, expect, it } from '@effect/vitest'
import { type AssistantConversationLifecycle } from './assistant/lifecycle.ts'
import { objectKeyFor, pendingWhere } from './governance/workspace-export.internal.ts'

/**
 * Type-level guards for positional identity arguments the audits named. Each
 * site has a correct-order call that must compile and a swapped call whose
 * `@ts-expect-error` is the assertion; the functions never run.
 */
type Lifecycle = AssistantConversationLifecycle['Service']

function lifecycleOwnerPosition(lifecycle: Lifecycle, userId: UserId, otherId: string) {
  return [
    lifecycle.deleteOwned(userId, otherId),
    // @ts-expect-error A conversation id cannot name the deleting owner.
    lifecycle.deleteOwned(otherId, userId),
    lifecycle.collectForExport(userId, otherId),
    // @ts-expect-error A session id cannot name the exporting owner.
    lifecycle.collectForExport(otherId, userId),
    lifecycle.validateExport(userId, otherId, []),
    // @ts-expect-error A session id cannot name the validating owner.
    lifecycle.validateExport(otherId, userId, [])
  ]
}

function exportWorkspacePosition(workspaceId: WorkspaceId, exportId: string) {
  return [
    objectKeyFor(workspaceId, exportId),
    // @ts-expect-error The R2 prefix is the workspace, not the export.
    objectKeyFor(exportId, workspaceId),
    pendingWhere(exportId, workspaceId),
    // @ts-expect-error The pending-row filter scopes by workspace second.
    pendingWhere(workspaceId, exportId)
  ]
}

describe('branded identity arguments', () => {
  it('refuses a conversation or session id in the owner position', () => {
    expect(lifecycleOwnerPosition).toBeTypeOf('function')
  })

  it('refuses an export id in the workspace position of export helpers', () => {
    expect(exportWorkspacePosition).toBeTypeOf('function')
  })
})
