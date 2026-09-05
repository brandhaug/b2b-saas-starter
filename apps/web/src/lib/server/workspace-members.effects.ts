import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  planById,
  seatUsage
} from '@b2b-saas-starter/capabilities/billing/plan-catalog'
import { type Member } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { WorkspaceInvitations } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import {
  WorkspaceMembership,
  type MemberRef,
  type MemberRoleInput
} from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import {
  type CapabilityUnavailable,
  type MembershipChangeRejected
} from '@b2b-saas-starter/capabilities/errors'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission, whenPermitted } from './authorize'
import { webMemberBinding } from './member-binding'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'
import {
  type ChangeMemberRoleInput,
  type LeaveWorkspaceInput,
  type LoadWorkspaceMembersInput,
  type RemoveMemberInput,
  type WorkspaceMembersPayload
} from './workspace-members'

/**
 * The members payload composition, the member effects and their server-only
 * wiring, reached only through dynamic `import()` inside the handlers of
 * `workspace-members.ts`: handler bodies are stripped from the client build,
 * so this graph ships to the server alone. `workspace-members.ts` holds the
 * client-safe half and the reason for the split.
 *
 * The member effects take only their own inputs, which is what makes the
 * `member:update` / `member:delete` gates and the hand-off to the membership
 * capability testable without a request or an auth runtime
 * (`workspace-members.test.ts`). Each `…Handler` adds the session gate and
 * the wiring, nothing else.
 */

/**
 * `notification:read` is the page's own read permission and a hard gate —
 * same shape as every page. A `member` holds it; only an actorless context
 * fails it.
 */
const membersPayload: WorkspacePageFrame<WorkspaceMembersPayload> = workspacePage(
  { notification: ['read'] },
  (ctx) =>
    Effect.flatMap(
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
      ),
      (segments) =>
        Effect.succeed({
          ...segments,
          // The plan gate's seat half: a flat plan past its included seats
          // prompts for an upgrade; a per-seat plan just bills the seats.
          seatUsage: seatUsage(planById(ctx.workspace.planId), segments.members.length)
        })
    )
)

/**
 * The loader as a plain function, so tests drive it directly with fixture
 * actors (`workspace-members.test.ts`) — no request, no auth runtime. The
 * actor is the session's user; the layout route's gate has already proved
 * membership, and `runWorkspaceCapabilities` re-proves it server-side.
 */
export function loadWorkspaceMembers(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceMembersPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, membersPayload, {
    userId: input.userId
  })
}

export async function loadWorkspaceMembersHandler(
  input: LoadWorkspaceMembersInput
): Promise<WorkspaceMembersPayload> {
  const session = await requireRequestSession()
  return loadWorkspaceMembers({
    workspaceSlug: input.workspaceSlug,
    userId: session.user.id
  })
}

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

export async function changeMemberRoleHandler(
  input: ChangeMemberRoleInput
): Promise<Member> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    changeMemberRole({ userId: input.userId, role: input.role }),
    { userId: session.user.id },
    // The adapter lives server-only and rides per call — see
    // `member-binding.ts` for why it cannot sit on `starterEnv`.
    { memberBinding: webMemberBinding }
  )
}

/**
 * Off-boarding a member, below the session gate: `member:delete` (owner and
 * admin hold it in the role table) decides who may ask, and the capability's
 * ownership rule decides what the workspace refuses — the sole owner first
 * among them, which the boundary words as "transfer ownership first". The
 * actor's own row is not this verb; that is `leaveWorkspace` below.
 */
export function removeMember(
  input: MemberRef
): Effect.Effect<
  void,
  AuthorizationDenied | CapabilityUnavailable | MembershipChangeRejected,
  Scope.Scope | WorkspaceContext | WorkspaceMembership
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ member: ['delete'] })
    const membership = yield* WorkspaceMembership
    return yield* membership.removeMember(input)
  })
}

export async function removeMemberHandler(input: RemoveMemberInput): Promise<void> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    removeMember({ userId: input.userId }),
    { userId: session.user.id },
    { memberBinding: webMemberBinding }
  )
}

/**
 * Leaving: the actor's own membership, ended by their own hand. No permission
 * statement gates it — the authz matrix has no self-action, and any member
 * may leave — because `WorkspaceContext` is the proof that the membership
 * exists, and the capability's sole-owner rule (the plugin's own) is the one
 * refusal, worded as "transfer ownership first" at the boundary.
 */
export function leaveWorkspace(): Effect.Effect<
  void,
  CapabilityUnavailable | MembershipChangeRejected,
  Scope.Scope | WorkspaceContext | WorkspaceMembership
> {
  return Effect.flatMap(WorkspaceMembership, (membership) => membership.leave)
}

export async function leaveWorkspaceHandler(input: LeaveWorkspaceInput): Promise<void> {
  // The input carries no identity because there is none to carry: the
  // leaver is the session's own user, and a non-member gets the same
  // non-disclosing 404 every workspace route gives them.
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    leaveWorkspace(),
    { userId: session.user.id },
    { memberBinding: webMemberBinding }
  )
}
