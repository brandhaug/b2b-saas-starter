import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type WorkspaceSuspended } from '@b2b-saas-starter/capabilities/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { type CapabilityServices } from '@b2b-saas-starter/capabilities/layers'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import {
  WorkspaceContext,
  type WorkspaceContextInterface,
  type WorkspaceServices
} from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, type Scope } from 'effect'

import { type UnauthorizedError } from './auth'
import { requireWorkspacePermission } from './authorize'
import { type WorkspacePagePayload } from '@/lib/workspace-frame'
import {
  type StrongAuthentication,
  type StrongAuthenticationRequired
} from '@b2b-saas-starter/capabilities/governance/strong-authentication'

/**
 * What a workspace page's loader effect is, once assembled: the payload the
 * route renders, the two failures every page can raise, and the requirements
 * `runWorkspaceCapabilities` provides. Annotating the loader effect with this
 * is what pins the assembled shape to the page's declared payload type — the
 * requirement union is the same for every page, so spelling out each page's
 * own services bought nothing but eight copies of it.
 */
export type WorkspacePageFrame<Payload> = Effect.Effect<
  Payload,
  | AuthorizationDenied
  | CapabilityUnavailable
  | WorkspaceSuspended
  | StrongAuthenticationRequired
  // The permission gate reads the session, and an expired one is a typed
  // failure rather than a defect (`server/auth.ts`).
  | UnauthorizedError,
  CapabilityServices | WorkspaceServices | WorkspaceSuspensionService | Scope.Scope
>

/** The unread-notification count the workspace shell badges. */
const unreadCount: Effect.Effect<
  number,
  CapabilityUnavailable,
  NotificationFeed | WorkspaceServices
> = Effect.flatMap(NotificationFeed, (feed) => feed.unreadCount)

/**
 * The opening and closing every workspace page shares, in one place.
 *
 * `gate` is the page's **own** read permission and a hard gate: an actor
 * without it has no page to render, so that is a 403 rather than an empty
 * shell. Segments below it that carry a second permission stay soft — wrap
 * those in `whenPermitted` (`./authorize.ts`), which yields `null` so the
 * read never runs and the number never reaches the SSR payload.
 *
 * The frame closes by attaching the `WorkspaceFrame` (`../workspace-frame.ts`):
 * `viewer` — the actor's workspace role, the value `viewerCan` re-decides on
 * the client — and `unreadCount`, the shell's notification badge, read
 * concurrently with the segment. The frame owns both so no page can forget
 * them: a page that omitted the count once lost its badge silently. `viewer`
 * is declared here rather than in `@b2b-saas-starter/capabilities` because
 * which segments exist is an authorization decision, and a capability does
 * not make those (see that package's intent node).
 *
 * `segment` receives the resolved context, so a page that renders the
 * workspace's own name (settings, billing) can read it without a second
 * `yield* WorkspaceContext`.
 */
export function workspacePage<Segment, E, R>(
  gate: PermissionRequest,
  segment: (ctx: WorkspaceContextInterface) => Effect.Effect<Segment, E, R>
): Effect.Effect<
  WorkspacePagePayload<Segment>,
  | E
  | AuthorizationDenied
  | CapabilityUnavailable
  | WorkspaceSuspended
  | StrongAuthenticationRequired
  | UnauthorizedError,
  | R
  | NotificationFeed
  | WorkspaceServices
  | WorkspaceSuspensionService
  | StrongAuthentication
  | Scope.Scope
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission(gate)
    const ctx = yield* WorkspaceContext
    const [assembled, unread] = yield* Effect.all([segment(ctx), unreadCount], {
      concurrency: 'unbounded'
    })
    return {
      ...assembled,
      viewer: ctx.actor ? { role: ctx.actor.role } : null,
      unreadCount: unread
    }
  })
}
