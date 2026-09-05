import { type CreatedWorkspace } from '@b2b-saas-starter/capabilities/governance/workspace-lifecycle'
import { type Workspace } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * Server functions for the workspace lifecycle, in a **client-safe** module —
 * the `invitations.ts` pattern: create (from the signed-in user's "my
 * workspaces" page — no workspace context exists yet), rename and delete
 * (settings route). The two authz statements that were declared but never
 * enforced — `organization:update` and `organization:delete` — are enforced
 * in the effects file, exactly where every other workspace mutation's gate
 * lives.
 *
 * The client-safe half of the `workspace-lifecycle.effects.ts` split; see
 * apps/web/AGENTS.md for the rule and `scripts/assert-client-boundary.mjs`
 * for the enforcement. Each input is written once, as its Effect Schema: the
 * validator is the single strict decode, and the derived types below type
 * both the client stub and the effects handlers.
 */

// The slug rule is lowercase letters, digits, and inner hyphens; the plugin
// enforces uniqueness on top of it.
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

const CreateWorkspaceInput = Schema.Struct({
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  slug: Schema.NonEmptyString.check(Schema.isPattern(WORKSPACE_SLUG_PATTERN)).check(
    Schema.isMinLength(3)
  )
})

const RenameWorkspaceInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80))
})

const DeleteWorkspaceInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type CreateWorkspaceInput = typeof CreateWorkspaceInput.Type
export type RenameWorkspaceInput = typeof RenameWorkspaceInput.Type
export type DeleteWorkspaceInput = typeof DeleteWorkspaceInput.Type

export const createWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(CreateWorkspaceInput))
  .handler(async ({ data }): Promise<CreatedWorkspace> => {
    const { createWorkspaceHandler } = await import('./workspace-lifecycle.effects')
    return createWorkspaceHandler(data)
  })

// Rename and delete ARE workspace-scoped: the settings route resolves the
// workspace and the permission gates prove the actor may touch it.

export const renameWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(RenameWorkspaceInput))
  .handler(async ({ data }): Promise<Workspace> => {
    const { renameWorkspaceHandler } = await import('./workspace-lifecycle.effects')
    return renameWorkspaceHandler(data)
  })

export const deleteWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(DeleteWorkspaceInput))
  .handler(async ({ data }): Promise<void> => {
    const { deleteWorkspaceHandler } = await import('./workspace-lifecycle.effects')
    return deleteWorkspaceHandler(data)
  })
