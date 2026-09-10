import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { SsoConnections } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { Billing } from '@b2b-saas-starter/billing/billing'
import {
  authorize,
  memberPrincipal,
  needsStrongAuthentication
} from '@b2b-saas-starter/authz/client'
import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { strongAuthenticationStatusFor } from './strong-authentication.effects'
import {
  type WorkspaceRecoveryPayload,
  type WorkspaceSuspensionGatePayload
} from './workspace-suspension'

function may(
  role: 'owner' | 'admin' | 'member',
  permission: Parameters<typeof authorize>[1]
) {
  return authorize(memberPrincipal(role), permission).success
}

function missingActor() {
  return Effect.fail(new AuthorizationDenied({ reason: 'no_principal' }))
}

export async function loadWorkspaceSuspensionHandler(input: {
  readonly workspaceSlug: string
}): Promise<WorkspaceSuspensionGatePayload> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    workspaceSuspensionGate(session.session.id),
    { userId: session.user.id }
  )
}

/**
 * The gate the `/workspaces/$workspaceSlug` subtree reads before any page of
 * it loads: the workspace's suspension state plus whether this session still
 * owes privileged-authentication proof.
 *
 * The authentication question is *reported*, not enforced. Enforcement stays
 * in `authorize.ts`, where every capability call meets it; asking it here as
 * well is what lets the route redirect an unverified owner to
 * /verify-authentication instead of letting the first page loader fail into
 * an error boundary. Exported at the Effect seam so the policy is testable
 * without a session, like the recovery projection below.
 *
 * The evidence read goes through `strongAuthenticationStatusFor`, the
 * request-scoped memo slot, so asking here does not add a D1 round trip to a
 * navigation whose page also asks.
 */
export function workspaceSuspensionGate(sessionId: string) {
  return Effect.gen(function* () {
    const context = yield* WorkspaceContext
    const service = yield* WorkspaceSuspensionService
    const state = yield* service.get(context.workspace.id)
    const actor = context.actor
    if (actor === null) {
      return yield* missingActor()
    }
    const privileged = may(actor.role, { organization: ['update'] })
    const strongAuthenticationRequired = needsStrongAuthentication({
      systemRole: actor.systemRole,
      workspaceRole: actor.role
    })
      ? !(yield* Effect.promise(() =>
          strongAuthenticationStatusFor({ userId: actor.userId, sessionId })
        )).qualified
      : false
    return {
      workspaceId: state.workspaceId,
      status: state.status,
      changedAt: state.changedAt,
      customerExplanation: privileged ? state.customerExplanation : null,
      workspaceName: context.workspace.name,
      viewer: { role: actor.role },
      strongAuthenticationRequired
    }
  })
}

/** Reads only the narrow services explicitly usable during suspension. */
export async function loadWorkspaceRecoveryHandler(input: {
  readonly workspaceSlug: string
}): Promise<WorkspaceRecoveryPayload> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(input.workspaceSlug, workspaceRecoveryPayload, {
    userId: session.user.id
  })
}

/** Narrow recovery projection, exported at the Effect seam for policy tests. */
export const workspaceRecoveryPayload = Effect.gen(function* () {
  const context = yield* WorkspaceContext
  const actor = context.actor
  if (actor === null) {
    return yield* missingActor()
  }
  const suspension = yield* WorkspaceSuspensionService
  const state = yield* suspension.get(context.workspace.id)
  const canSeeExplanation = may(actor.role, { organization: ['update'] })
  const canManageBilling = may(actor.role, { organization: ['update'] })
  const canListTokens = may(actor.role, { apiToken: ['list'] })
  const canRepairSso =
    may(actor.role, { organization: ['delete'] }) && may(actor.role, { sso: ['list'] })
  const recovery = yield* Effect.all({
    billingConfigured: canManageBilling
      ? Effect.flatMap(Billing, (billing) => billing.configured)
      : Effect.succeed(false),
    apiTokens: canListTokens
      ? Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.list)
      : Effect.succeed(null),
    ssoConnections: canRepairSso
      ? Effect.flatMap(SsoConnections, (sso) => sso.list)
      : Effect.succeed(null)
  })
  return {
    workspaceId: state.workspaceId,
    workspaceName: context.workspace.name,
    status: state.status,
    changedAt: state.changedAt,
    customerExplanation: canSeeExplanation ? state.customerExplanation : null,
    viewer: { role: actor.role },
    canViewExplanation: canSeeExplanation,
    canManageBilling,
    ...recovery
  }
})
