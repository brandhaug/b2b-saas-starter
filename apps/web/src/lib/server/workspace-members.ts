import { type SeatUsage } from '@b2b-saas-starter/capabilities/billing/plan-catalog'
import { type Member } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { WORKSPACE_ROLES, type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The workspace-members server functions, in a **client-safe** module: the
 * client-safe half of the `workspace-members.effects.ts` split (see
 * apps/web/AGENTS.md for the rule and `assert-client-boundary.mjs` for the
 * enforcement). Each input is written once, as its Effect Schema — the
 * validator is the single strict decode, and the derived types below type
 * both the client stub and the effects handlers.
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

const LoadWorkspaceMembersInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const ChangeMemberRoleInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
  role: Schema.Literals(WORKSPACE_ROLES)
})

const RemoveMemberInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  userId: Schema.NonEmptyString
})

const LeaveWorkspaceInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type LoadWorkspaceMembersInput = typeof LoadWorkspaceMembersInput.Type
export type ChangeMemberRoleInput = typeof ChangeMemberRoleInput.Type
export type RemoveMemberInput = typeof RemoveMemberInput.Type
export type LeaveWorkspaceInput = typeof LeaveWorkspaceInput.Type

/** The members route's loader. */
export const loadWorkspaceMembersServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(LoadWorkspaceMembersInput))
  .handler(async ({ data }): Promise<WorkspaceMembersPayload> => {
    const { loadWorkspaceMembersHandler } = await import('./workspace-members.effects')
    return loadWorkspaceMembersHandler(data)
  })

export const changeMemberRoleServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(ChangeMemberRoleInput))
  .handler(async ({ data }): Promise<Member> => {
    const { changeMemberRoleHandler } = await import('./workspace-members.effects')
    return changeMemberRoleHandler(data)
  })

export const removeMemberServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(RemoveMemberInput))
  .handler(async ({ data }): Promise<void> => {
    const { removeMemberHandler } = await import('./workspace-members.effects')
    return removeMemberHandler(data)
  })

export const leaveWorkspaceServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(LeaveWorkspaceInput))
  .handler(async ({ data }): Promise<void> => {
    const { leaveWorkspaceHandler } = await import('./workspace-members.effects')
    return leaveWorkspaceHandler(data)
  })
