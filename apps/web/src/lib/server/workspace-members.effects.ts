import { seatUsage } from '@b2b-saas-starter/capabilities/billing/plan-catalog'
import { Billing } from '@b2b-saas-starter/capabilities/billing/billing'
import { type Member } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { WorkspaceInvitations } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { Effect } from 'effect'

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
 * Each handler reads the session once, then proves the actor may act
 * (`member:update` / `member:delete`, declared → enforced inside the effect)
 * before handing the change to the membership capability.
 */

/**
 * `notification:read` is the page's own read permission and a hard gate —
 * same shape as every page. A `member` holds it; only an actorless context
 * fails it.
 */
const membersPayload: WorkspacePageFrame<WorkspaceMembersPayload> = workspacePage(
  { notification: ['read'] },
  () =>
    Effect.flatMap(
      Effect.all(
        {
          unreadCount,
          plan: Effect.flatMap(Billing, (billing) => billing.currentPlan),
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
          seatUsage: seatUsage(segments.plan, segments.members.length)
        })
    )
)

export async function loadWorkspaceMembersHandler(
  input: LoadWorkspaceMembersInput
): Promise<WorkspaceMembersPayload> {
  // The actor is the session's user; the layout route's gate has already
  // proved membership, and `runWorkspaceCapabilities` re-proves it
  // server-side.
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(input.workspaceSlug, membersPayload, {
    userId: session.user.id
  })
}

/**
 * Self-promotion and self-demotion are refused by Better Auth itself (the
 * plugin endpoint checks the acting member against its own rules); the gate
 * below refuses everyone the role table already refuses.
 */
export async function changeMemberRoleHandler(
  input: ChangeMemberRoleInput
): Promise<Member> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // The session gate above proves who is asking; this proves they may.
      yield* requireWorkspacePermission({ member: ['update'] })
      const membership = yield* WorkspaceMembership
      return yield* membership.changeRole({ userId: input.userId, role: input.role })
    }),
    { userId: session.user.id },
    // The adapter lives server-only and rides per call — see
    // `member-binding.ts` for why it cannot sit on `starterEnv`.
    { memberBinding: webMemberBinding }
  )
}

/**
 * Off-boarding a member: `member:delete` (owner and admin hold it in the
 * role table) decides who may ask, and the capability's ownership rule
 * decides what the workspace refuses — the sole owner first among them,
 * which the boundary words as "transfer ownership first". The actor's own
 * row is not this verb; that is `leaveWorkspaceHandler` below.
 */
export async function removeMemberHandler(input: RemoveMemberInput): Promise<void> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ member: ['delete'] })
      const membership = yield* WorkspaceMembership
      return yield* membership.removeMember({ userId: input.userId })
    }),
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
export async function leaveWorkspaceHandler(input: LeaveWorkspaceInput): Promise<void> {
  // The input carries no identity because there is none to carry: the
  // leaver is the session's own user, and a non-member gets the same
  // non-disclosing 404 every workspace route gives them.
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.flatMap(WorkspaceMembership, (membership) => membership.leave),
    { userId: session.user.id },
    { memberBinding: webMemberBinding }
  )
}
