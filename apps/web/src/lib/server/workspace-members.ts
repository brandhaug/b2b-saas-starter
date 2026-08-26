import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  WorkspaceMembership,
  type MemberRoleInput
} from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import {
  WorkspaceRole as WorkspaceRoleSchema,
  type Member,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import {
  type CapabilityUnavailable,
  type MembershipChangeRejected
} from '@b2b-saas-starter/capabilities/errors'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { webMemberBinding } from './member-binding'

/**
 * The workspace members payload.
 *
 * Reading the roster is a member's own standing: the `WorkspaceContext` layer
 * has already proved membership (non-members get `WorkspaceNotFound`), and the
 * roster carries no security posture the way tokens or invitations do. What
 * *changes* the roster is gated — `member:update` on the server, `viewerCan`
 * in the component.
 */
export type WorkspaceMembersPayload = {
  readonly viewer: { readonly role: WorkspaceRole } | null
  readonly unreadCount: number
  readonly members: readonly Member[]
}

/**
 * `notification:read` is the page's own read permission and a hard gate —
 * same shape as the settings page. A `member` holds it; only an actorless
 * context fails it.
 */
const membersPayload: Effect.Effect<
  WorkspaceMembersPayload,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | WorkspaceMembership | NotificationFeed
> = Effect.gen(function* () {
  yield* requireWorkspacePermission({ notification: ['read'] })
  const ctx = yield* WorkspaceContext
  const membership = yield* WorkspaceMembership
  const feed = yield* NotificationFeed
  const [unreadCount, members] = yield* Effect.all(
    [feed.unreadCount, membership.listMembers],
    { concurrency: 'unbounded' }
  )
  return {
    viewer: ctx.actor ? { role: ctx.actor.role } : null,
    unreadCount,
    members
  }
})

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
