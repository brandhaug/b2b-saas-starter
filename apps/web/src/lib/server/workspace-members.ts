import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  WorkspaceMembership,
  type MemberRoleInput
} from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import {
  WorkspaceInvitations,
  type Invitation
} from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import {
  WorkspaceRole as WorkspaceRoleSchema,
  type Member
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type WorkspaceViewer } from '@/lib/permissions'
import {
  type CapabilityUnavailable,
  type MembershipChangeRejected
} from '@b2b-saas-starter/capabilities/errors'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission, whenPermitted } from './authorize'
import { webMemberBinding } from './member-binding'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'

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
}

/**
 * `notification:read` is the page's own read permission and a hard gate —
 * same shape as every page. A `member` holds it; only an actorless context
 * fails it.
 */
const membersPayload: WorkspacePageFrame<WorkspaceMembersPayload> = workspacePage(
  { notification: ['read'] },
  () =>
    Effect.all(
      {
        unreadCount,
        members: Effect.flatMap(WorkspaceMembership, (roster) => roster.listMembers),
        invitations: whenPermitted(
          { invitation: ['create'] },
          Effect.flatMap(WorkspaceInvitations, (invites) => invites.list)
        )
      },
      { concurrency: 'unbounded' }
    )
)

/** The members route's loader. */
export function loadWorkspaceMembers(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceMembersPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, membersPayload, {
    userId: input.userId
  })
}

// All input constraints live in the schema — no imperative re-validation.
const ChangeMemberRoleInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
  role: WorkspaceRoleSchema
})

const decodeInput = Schema.decodeUnknownSync(ChangeMemberRoleInput)

/**
 * The effect below the session gate: proves the actor may manage members
 * (`member:update`, declared → enforced here), then hands the change to the
 * capability. Exported so tests drive it against fixture layers without a
 * request or an auth runtime.
 *
 * Self-promotion and self-demotion are refused by Better Auth itself (the
 * plugin endpoint checks the acting member against its own rules); this guard
 * refuses everyone the role table already refuses.
 */
export function changeMemberRole(
  input: MemberRoleInput
): Effect.Effect<
  Member,
  AuthorizationDenied | CapabilityUnavailable | MembershipChangeRejected,
  Scope.Scope | WorkspaceContext | WorkspaceMembership
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ member: ['update'] })
    const membership = yield* WorkspaceMembership
    return yield* membership.changeRole(input)
  })
}

export const changeMemberRoleServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeInput(input))
  .handler(async ({ data }): Promise<Member> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      changeMemberRole({ userId: data.userId, role: data.role }),
      { userId: session.user.id },
      // The adapter lives server-only and rides per call — see
      // `member-binding.ts` for why it cannot sit on `starterEnv`.
      { memberBinding: webMemberBinding }
    )
  })
