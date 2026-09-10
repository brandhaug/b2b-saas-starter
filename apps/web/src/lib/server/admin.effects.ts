import { m } from '@b2b-saas-starter/i18n/messages'
import {
  AuditEventLog,
  type AuditEvent
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  PlatformUserAdmin,
  type ImpersonationStarted
} from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { type Member } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import {
  WorkspaceMembership,
  type WorkspaceWithMembership
} from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { adminSystemRole } from '@b2b-saas-starter/db/enums'
import { Effect } from 'effect'
import { env } from 'cloudflare:workers'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { CapabilityUnavailableError } from '../capability-error'
import { webRuntime, withWebRequestScope } from '../observability'

import { runCapabilities } from '../capabilities'
import {
  type ChangeWorkspaceRoleInput,
  type FailedDeliveriesInput,
  type FailedDeliveriesPayload,
  type ReplayFailedDeliveryInput,
  type ReplayFailedDeliveryResult,
  type SystemUser,
  type SystemUserInput,
  type AdminWorkspace,
  type WorkspaceSuspensionInput
} from './admin'
import { requireRequestSession, UnauthorizedError } from './auth'
import {
  requireStrongAuthentication,
  requireRecentAuthentication
} from './strong-authentication.effects'
import { webUserAdminBinding } from './user-admin-binding'

/**
 * Typed failure for the impersonation server functions when the request's
 * session is not what the action needs: starting one from a session that is
 * already an impersonation (no nesting — the admin cookie holds one token),
 * or stopping one from an ordinary session. Same shape and reason as
 * `UnauthorizedError`: server functions serialize thrown errors with
 * `name`/`message` intact, and the calling control shows `message`.
 *
 * Defined here (its only thrower) so the client-safe `admin.ts` never imports
 * a value back from its effects sibling — that would be a module cycle the
 * dead-code gate rejects.
 */
export class ImpersonationStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImpersonationStateError'
  }
}

/**
 * The `/admin` capability effects and their server-only wiring, reached only
 * through dynamic `import()` inside the handlers in `admin.ts` (see
 * apps/web/AGENTS.md for the split) — the platform user-admin service, the
 * global audit log, the Better Auth session gate, and the plugin binding all
 * ship to the server alone.
 */

/** System-level user list. Direct server calls verify the admin role and
 * this session's strong authentication before reading platform data. */
export async function listSystemUsersHandler(): Promise<ReadonlyArray<SystemUser>> {
  await requireAdminSession()
  const users = await runCapabilities(
    Effect.gen(function* () {
      const admin = yield* PlatformUserAdmin
      return yield* admin.listUsers
    })
  )
  return users.map((account) => ({
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.systemRole,
    banned: account.banned
  }))
}

export async function listAdminWorkspacesHandler(): Promise<
  ReadonlyArray<AdminWorkspace>
> {
  await requireAdminSession()
  return runCapabilities(
    Effect.flatMap(WorkspaceSuspensionService, (service) => service.list)
  )
}

export async function transitionAdminWorkspaceHandler(input: WorkspaceSuspensionInput) {
  const session = await requireAdminSession()
  await requireRecentAuthentication(session)
  return runCapabilities(
    Effect.gen(function* () {
      const suspension = yield* WorkspaceSuspensionService
      return yield* suspension.transition({
        workspaceId: input.workspaceId,
        action: input.action,
        actor: {
          userId: session.user.id,
          impersonatedBy: session.session.impersonatedBy
        },
        internalReason: input.internalReason,
        customerExplanation: input.customerExplanation
      })
    })
  )
}

/** Global audit reads require the same session gate as admin mutations. */
export async function loadAdminAuditEventsHandler(): Promise<
  ReadonlyArray<AuditEvent>
> {
  await requireAdminSession()
  return runCapabilities(
    Effect.gen(function* () {
      const log = yield* AuditEventLog
      return yield* log.listGlobal
    })
  )
}

/**
 * Shared gate for direct admin reads and mutations. Every handler verifies
 * the request's system role and strong authentication before calling a capability.
 */
async function requireAdminSession() {
  const session = await requireRequestSession()
  if (session.user.role !== adminSystemRole) {
    // oxlint-disable-next-line effect/noThrowStatement -- TanStack Start serializes a thrown server-fn error back to the caller; the returned Promise has no error channel
    throw new UnauthorizedError()
  }
  await requireStrongAuthentication(session)
  return session
}

export async function loadFailedDeliveriesHandler(
  input: FailedDeliveriesInput
): Promise<FailedDeliveriesPayload> {
  await requireAdminSession()
  return runCapabilities(
    Effect.flatMap(WebhookEndpoints, (webhooks) =>
      webhooks.listGlobalDeliveries({ ...input, limit: 20 })
    )
  )
}

export async function replayFailedDeliveryHandler(
  input: ReplayFailedDeliveryInput
): Promise<ReplayFailedDeliveryResult> {
  const session = await requireAdminSession()
  if (session.session.impersonatedBy) {
    // oxlint-disable-next-line effect/noThrowStatement -- serialized server-fn refusal
    throw new ImpersonationStateError('Stop impersonating before replaying deliveries.')
  }
  if (env.DB !== undefined && env.WEBHOOK_QUEUE === undefined) {
    return {
      status: 'refused',
      reason: m.server_replay_queue_unconfigured()
    }
  }
  // This server-only path includes WEBHOOK_QUEUE. The shared web read runner
  // omits that binding; using it for a Live replay would never enqueue.
  return webRuntime.runPromise(
    withWebRequestScope(
      { event: 'admin.webhook.replay', metadata: { actorUserId: session.user.id } },
      Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const result = yield* webhooks.replayDeliveryAsAdmin({
          deliveryId: input.deliveryId,
          actorUserId: session.user.id
        })
        return {
          status: 'queued',
          deliveryId: result.deliveryId
        } satisfies ReplayFailedDeliveryResult
      }).pipe(
        Effect.catchTag('WebhookDispatchRejected', () =>
          Effect.succeed({
            status: 'refused',
            reason: m.server_replay_refused()
          } satisfies ReplayFailedDeliveryResult)
        ),
        Effect.mapError(
          (error) => new CapabilityUnavailableError(error.capability, error.reason)
        ),
        Effect.provide(selectCapabilitiesLayer(starterEnv(env)))
      )
    )
  )
}

export async function banSystemUserHandler(input: SystemUserInput): Promise<void> {
  const session = await requireAdminSession()
  await requireRecentAuthentication(session)
  return runCapabilities(
    Effect.gen(function* () {
      const admin = yield* PlatformUserAdmin
      return yield* admin.banUser({
        userId: input.userId,
        actorUserId: session.user.id
      })
    }),
    { userAdminBinding: webUserAdminBinding }
  )
}

export async function unbanSystemUserHandler(input: SystemUserInput): Promise<void> {
  const session = await requireAdminSession()
  await requireRecentAuthentication(session)
  return runCapabilities(
    Effect.gen(function* () {
      const admin = yield* PlatformUserAdmin
      return yield* admin.unbanUser({
        userId: input.userId,
        actorUserId: session.user.id
      })
    }),
    { userAdminBinding: webUserAdminBinding }
  )
}

/**
 * A user's memberships across workspaces, for the per-user role editor. The
 * same identity-keyed read "my workspaces" uses — an admin sees what the user
 * would, which is exactly the scope the role change acts on.
 */
export async function listUserWorkspacesHandler(
  input: SystemUserInput
): Promise<ReadonlyArray<WorkspaceWithMembership>> {
  await requireAdminSession()
  return runCapabilities(
    Effect.gen(function* () {
      const membership = yield* WorkspaceMembership
      return yield* membership.listWorkspacesForUser(input.userId)
    })
  )
}

export async function changeUserWorkspaceRoleHandler(
  input: ChangeWorkspaceRoleInput
): Promise<Member> {
  const session = await requireAdminSession()
  await requireRecentAuthentication(session)
  return runCapabilities(
    Effect.gen(function* () {
      const admin = yield* PlatformUserAdmin
      return yield* admin.changeWorkspaceRole({
        userId: input.userId,
        workspaceId: input.workspaceId,
        role: input.role,
        actorUserId: session.user.id
      })
    }),
    { userAdminBinding: webUserAdminBinding }
  )
}

/**
 * Starts an impersonation session (ADR 0054). The route's gate, this gate,
 * the capability's own refusals (unknown user, System Admin target, self) and
 * Better Auth's `adminMiddleware` all have to agree before a cookie moves.
 * No nesting: an impersonation session cannot start another — the browser
 * holds one admin cookie, and the plugin would overwrite it.
 */
export async function impersonateUserHandler(
  input: SystemUserInput
): Promise<ImpersonationStarted> {
  const session = await requireAdminSession()
  await requireRecentAuthentication(session)
  if (session.session.impersonatedBy) {
    // oxlint-disable-next-line effect/noThrowStatement -- TanStack Start serializes a thrown server-fn error back to the caller; the returned Promise has no error channel
    throw new ImpersonationStateError('Stop the current impersonation first.')
  }
  return runCapabilities(
    Effect.gen(function* () {
      const admin = yield* PlatformUserAdmin
      return yield* admin.startImpersonation({
        userId: input.userId,
        actorUserId: session.user.id
      })
    }),
    { userAdminBinding: webUserAdminBinding }
  )
}

/**
 * Ends the request's impersonation session and restores the admin's own. The
 * actor is read off the session itself (`impersonatedBy`), never off the
 * request body — the impersonated user holds no admin role, so
 * `requireAdminSession` would refuse them; the plugin's own endpoint applies
 * the matching check server-side.
 */
export async function stopImpersonatingHandler(): Promise<void> {
  const session = await requireRequestSession()
  const actorUserId = session.session.impersonatedBy
  if (!actorUserId) {
    // oxlint-disable-next-line effect/noThrowStatement -- TanStack Start serializes a thrown server-fn error back to the caller; the returned Promise has no error channel
    throw new ImpersonationStateError('This session is not impersonating anyone.')
  }
  return runCapabilities(
    Effect.gen(function* () {
      const admin = yield* PlatformUserAdmin
      return yield* admin.stopImpersonation({
        userId: session.user.id,
        actorUserId
      })
    }),
    { userAdminBinding: webUserAdminBinding }
  )
}
