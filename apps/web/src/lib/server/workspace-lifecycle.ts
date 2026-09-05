import { type CreatedWorkspace } from '@b2b-saas-starter/capabilities/governance/workspace-lifecycle'
import { type Workspace } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'

/**
 * Server functions for the workspace lifecycle, in a **client-safe** module —
 * the `invitations.ts` pattern: create (from the signed-in user's "my
 * workspaces" page — no workspace context exists yet), rename and delete
 * (settings route). The two authz statements that were declared but never
 * enforced — `organization:update` and `organization:delete` — are enforced
 * in the effects file, exactly where every other workspace mutation's gate
 * lives.
 *
 * This file is statically imported by the creation form and the settings
 * page, and the route tree ships to the browser — so everything at this
 * module's top level rides on every page. That is why the effects and their
 * imports (the capability service, the email-verification gate, the plugin
 * binding) live in `workspace-lifecycle.effects.ts` and are reached only
 * through dynamic `import()` inside each handler: TanStack Start strips
 * handler bodies from the client build, so the effects graph never ships.
 * The validators are stripped the same way — `.validator()` runs on the
 * server only — so the plain shape checks below are the server's first
 * decode, a wire-shape gate, while the strict schemas (the name bound, the
 * slug rule) decode again in the effects file.
 */

type CreateWorkspaceInput = {
  readonly name: string
  readonly slug: string
}

type RenameWorkspaceInput = {
  readonly workspaceSlug: string
  readonly name: string
}

type DeleteWorkspaceInput = {
  readonly workspaceSlug: string
}

/**
 * The server fns' validators, plain shape checks that run on the server only
 * (TanStack strips `.validator()` from the client build): they are the
 * server's first decode, a wire-shape gate, and the strict schemas — the
 * name bound, the slug rule — decode again in
 * `workspace-lifecycle.effects.ts`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeCreateInput(input: unknown): CreateWorkspaceInput {
  const record = expectRecord(input, 'workspace creation input')
  return {
    name: expectString(record, 'name', 'workspace creation input'),
    slug: expectString(record, 'slug', 'workspace creation input')
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeRenameInput(input: unknown): RenameWorkspaceInput {
  const record = expectRecord(input, 'workspace rename input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'workspace rename input'),
    name: expectString(record, 'name', 'workspace rename input')
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeDeleteInput(input: unknown): DeleteWorkspaceInput {
  const record = expectRecord(input, 'workspace deletion input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'workspace deletion input')
  }
}

export const createWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator(decodeCreateInput)
  .handler(async ({ data }): Promise<CreatedWorkspace> => {
    const { createWorkspaceHandler } = await import('./workspace-lifecycle.effects')
    return createWorkspaceHandler(data)
  })

// Rename and delete ARE workspace-scoped: the settings route resolves the
// workspace and the permission gates prove the actor may touch it.

export const renameWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator(decodeRenameInput)
  .handler(async ({ data }): Promise<Workspace> => {
    const { renameWorkspaceHandler } = await import('./workspace-lifecycle.effects')
    return renameWorkspaceHandler(data)
  })

export const deleteWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator(decodeDeleteInput)
  .handler(async ({ data }): Promise<void> => {
    const { deleteWorkspaceHandler } = await import('./workspace-lifecycle.effects')
    return deleteWorkspaceHandler(data)
  })
