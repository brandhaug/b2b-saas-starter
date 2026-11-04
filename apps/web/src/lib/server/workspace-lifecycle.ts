import { type CreatedWorkspace } from '@b2b-saas-starter/capabilities/governance/workspace-lifecycle'
import { type Workspace } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * Creation starts from the signed-in user's directory, before a workspace
 * context exists. Rename and delete require the target workspace's permissions.
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
