import { type SeatUsage } from '@b2b-saas-starter/capabilities/billing/plan-catalog'
import {
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'

/**
 * The workspace-members server functions, in a **client-safe** module.
 *
 * This file is statically imported by the members route and the members
 * panel, and the route tree ships to the browser — so everything at this
 * module's top level rides on every page. That is why the loader
 * composition, the member effects and their imports (the capability
 * services, the permission helpers, the member binding) live in
 * `workspace-members.effects.ts` and are reached only through dynamic
 * `import()` inside each handler: TanStack Start strips handler bodies from
 * the client build, so the capabilities graph never ships. The validators
 * are stripped the same way handler bodies are — `.validator()` runs on the
 * server only — so the plain shape checks below are the server's first
 * decode, a wire-shape gate that declares each fn's input type without
 * dragging the Effect Schema chunk onto the route tree, while the strict
 * schemas (role literals) decode again in the effects file before anything
 * runs.
 *
 * The behaviour itself is tested as the loader and effects in the effects
 * file (`workspace-members.test.ts`), driven directly with fixture actors.
 */

/**
 * The workspace members payload: the roster plus, for the roles that manage
 * membership, the pending invitations — both are membership concerns, so both
 * live on the members page (the settings page stopped carrying the invitation
 * flow when it became the workspace's identity surface).
 *
 * Reading the roster is a member's own standing: the `WorkspaceContext` layer
 * has already proved membership (non-members get `WorkspaceNotFound`), and the
 * roster carries no security posture the way tokens or invitations do. The
 * invitation list is the exception — reading it is the same right as managing
 * it (`invitation:create` has no `read` action), so it stays a soft segment:
 * `null` for a viewer who may not manage invitations, and the read never runs.
 */
export type WorkspaceMembersPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly unreadCount: number
  readonly members: ReadonlyArray<Member>
  readonly invitations: ReadonlyArray<Invitation> | null
  /**
   * How the roster sits against the plan's seat terms — the members page's
   * upgrade prompt reads this. Computed from the resolved workspace's plan,
   * so it follows `workspaces.planId` with no second read.
   */
  readonly seatUsage: SeatUsage
}

/** Input shape of `loadWorkspaceMembersServerFn`, for its client stub. */
type LoadWorkspaceMembersInput = {
  readonly workspaceSlug: string
}

/** Input shape of `changeMemberRoleServerFn`, for its client stub. */
type ChangeMemberRoleInput = {
  readonly workspaceSlug: string
  readonly userId: string
  readonly role: WorkspaceRole
}

/** Input shape of `removeMemberServerFn`, for its client stub. */
type RemoveMemberInput = {
  readonly workspaceSlug: string
  readonly userId: string
}

/** Input shape of `leaveWorkspaceServerFn`, for its client stub. */
type LeaveWorkspaceInput = {
  readonly workspaceSlug: string
}

/**
 * The server fns' validators, plain shape checks that run on the server only
 * (TanStack strips `.validator()` from the client build): they are the
 * server's first decode, and the strict schemas — role literals — decode
 * again in `workspace-members.effects.ts`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeLoadInput(input: unknown): LoadWorkspaceMembersInput {
  const record = expectRecord(input, 'members input')
  return { workspaceSlug: expectString(record, 'workspaceSlug', 'members input') }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeChangeRoleInput(input: unknown): ChangeMemberRoleInput {
  const record = expectRecord(input, 'member-role input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'member-role input'),
    userId: expectString(record, 'userId', 'member-role input'),
    // SAFETY: the strict schema in `workspace-members.effects.ts` re-decodes
    // the role against the literal tuple before anything runs; this check
    // only establishes the wire shape for the client stub's type.
    // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion -- the cast only narrows string to the role union the strict schema enforces
    role: expectString(
      record,
      'role',
      'member-role input'
    ) as ChangeMemberRoleInput['role']
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeRemoveInput(input: unknown): RemoveMemberInput {
  const record = expectRecord(input, 'remove-member input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'remove-member input'),
    userId: expectString(record, 'userId', 'remove-member input')
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeLeaveInput(input: unknown): LeaveWorkspaceInput {
  const record = expectRecord(input, 'leave input')
  return { workspaceSlug: expectString(record, 'workspaceSlug', 'leave input') }
}

/** The members route's loader. */
export const loadWorkspaceMembersServerFn = createServerFn({ method: 'GET' })
  .validator(decodeLoadInput)
  .handler(async ({ data }): Promise<WorkspaceMembersPayload> => {
    const { loadWorkspaceMembersHandler } = await import('./workspace-members.effects')
    return loadWorkspaceMembersHandler(data)
  })

export const changeMemberRoleServerFn = createServerFn({ method: 'POST' })
  .validator(decodeChangeRoleInput)
  .handler(async ({ data }): Promise<Member> => {
    const { changeMemberRoleHandler } = await import('./workspace-members.effects')
    return changeMemberRoleHandler(data)
  })

export const removeMemberServerFn = createServerFn({ method: 'POST' })
  .validator(decodeRemoveInput)
  .handler(async ({ data }): Promise<void> => {
    const { removeMemberHandler } = await import('./workspace-members.effects')
    return removeMemberHandler(data)
  })

export const leaveWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator(decodeLeaveInput)
  .handler(async ({ data }): Promise<void> => {
    const { leaveWorkspaceHandler } = await import('./workspace-members.effects')
    return leaveWorkspaceHandler(data)
  })
