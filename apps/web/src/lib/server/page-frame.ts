import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { type CapabilityServices } from '@b2b-saas-starter/capabilities/layers'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { type WorkspaceViewer } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import {
  WorkspaceContext,
  type WorkspaceContextInterface
} from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, type Scope } from 'effect'

import { requireWorkspacePermission } from './authorize'

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
  AuthorizationDenied | CapabilityUnavailable,
  CapabilityServices | WorkspaceContext | Scope.Scope
>

/**
 * The opening and closing every workspace page shares, in one place.
 *
 * `gate` is the page's **own** read permission and a hard gate: an actor
 * without it has no page to render, so that is a 403 rather than an empty
 * shell. Segments below it that carry a second permission stay soft — wrap
 * those in `whenPermitted` (`./authorize.ts`), which yields `null` so the
 * read never runs and the number never reaches the SSR payload.
 *
 * The frame closes by attaching `viewer` — the actor's workspace role, the one
 * thing every payload carries and the value `viewerCan` re-decides on the
 * client. It is declared here rather than in `@b2b-saas-starter/capabilities`
 * because which segments exist is an authorization decision, and a capability
 * does not make those (see that package's intent node).
 *
 * `segment` receives the resolved context, so a page that renders the
 * workspace's own name (settings, billing) can read it without a second
 * `yield* WorkspaceContext`.
 */
export function workspacePage<Segment, E, R>(
  gate: PermissionRequest,
  segment: (ctx: WorkspaceContextInterface) => Effect.Effect<Segment, E, R>
): Effect.Effect<
  Segment & { readonly viewer: WorkspaceViewer | null },
  E | AuthorizationDenied,
  R | WorkspaceContext | Scope.Scope
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission(gate)
    const ctx = yield* WorkspaceContext
    const assembled = yield* segment(ctx)
    return { ...assembled, viewer: ctx.actor ? { role: ctx.actor.role } : null }
  })
}

/**
 * The unread-notification count the workspace shell badges. Every page that
 * renders the badge reads it concurrently with its own segment, so it is a
 * value to compose into `Effect.all` rather than a step of the frame: the
 * dashboard already gets the count from its projection, and the assistant and
 * audit pages render no badge at all.
 */
export const unreadCount: Effect.Effect<
  number,
  CapabilityUnavailable,
  NotificationFeed | WorkspaceContext
> = Effect.flatMap(NotificationFeed, (feed) => feed.unreadCount)
