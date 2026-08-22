import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import {
  type CreatedWorkspace,
  type Workspace,
  WorkspaceLifecycle
} from '@b2b-saas-starter/capabilities'
import { runCapabilities, runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { webWorkspaceLifecycleBinding } from './workspace-binding'

/**
 * Server functions for the workspace lifecycle: create (from the signed-in
 * user's "my workspaces" page — no workspace context exists yet), rename and
 * delete (settings route). The two authz statements that were declared but
 * never enforced — `organization:update` and `organization:delete` — are
 * enforced here, on the server, exactly where every other workspace mutation's
 * gate lives.
 */

// All input constraints live in the schema — no imperative re-validation. The
// slug rule is lowercase letters, digits, and inner hyphens; the plugin
// enforces uniqueness on top of it.
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
const CreateWorkspaceInput = Schema.Struct({
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  slug: Schema.NonEmptyString.check(Schema.isPattern(WORKSPACE_SLUG_PATTERN)).check(
    Schema.isMinLength(3)
  ),
  userId: Schema.String
})

const decodeCreateInput = Schema.decodeUnknownSync(CreateWorkspaceInput)

export const createWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeCreateInput(input))
  .handler(async ({ data }): Promise<CreatedWorkspace> => {
    // Creating is not a workspace-scoped call: there is no workspace to resolve,
    // so this runs through `runCapabilities` with no `WorkspaceContext`. The
    // plugin itself makes the creator its first owner.
    await requireRequestSession()
    return runCapabilities(
      Effect.gen(function* () {
        const lifecycle = yield* WorkspaceLifecycle
        return yield* lifecycle.create({
          name: data.name,
          slug: data.slug,
          userId: data.userId
        })
      }),
      { lifecycleBinding: webWorkspaceLifecycleBinding }
    )
  })

// Rename and delete ARE workspace-scoped: the settings route resolves the
// workspace and the permission gates prove the actor may touch it.

const RenameWorkspaceInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80))
})

const decodeRenameInput = Schema.decodeUnknownSync(RenameWorkspaceInput)

export const renameWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeRenameInput(input))
  .handler(async ({ data }): Promise<Workspace> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        yield* requireWorkspacePermission({ organization: ['update'] })
        const lifecycle = yield* WorkspaceLifecycle
        return yield* lifecycle.rename({ name: data.name })
      }),
      { userId: session.user.id },
      { lifecycleBinding: webWorkspaceLifecycleBinding }
    )
  })

const DeleteWorkspaceInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const decodeDeleteInput = Schema.decodeUnknownSync(DeleteWorkspaceInput)

export const deleteWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeDeleteInput(input))
  .handler(async ({ data }): Promise<void> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        yield* requireWorkspacePermission({ organization: ['delete'] })
        const lifecycle = yield* WorkspaceLifecycle
        yield* lifecycle.remove
      }),
      { userId: session.user.id },
      { lifecycleBinding: webWorkspaceLifecycleBinding }
    )
  })
