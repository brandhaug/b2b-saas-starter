import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  CapabilityUnavailable,
  PlanLimitExceeded,
  WorkspaceNotFound
} from '@b2b-saas-starter/capabilities/errors'
import {
  selectCapabilitiesLayer,
  selectWorkspaceLayer,
  type StarterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import {
  type ActorRef,
  type WorkspaceContext
} from '@b2b-saas-starter/capabilities/workspace-context'
import { type CapabilityServices } from '@b2b-saas-starter/capabilities/layers'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { notFound } from '@tanstack/react-router'
import { Cause, Effect, Exit, Option, type Scope } from 'effect'

import {
  CapabilityUnavailableError,
  ForbiddenError,
  PlanLimitError
} from './capability-error'
import { webRuntime, withWebRequestScope } from './observability'

export type { CapabilityServices }

/**
 * Plugin-backed write adapters a caller supplies for the duration of one call.
 *
 * They are not part of the module-level `starterEnv` below, and deliberately so:
 * an adapter has to reach `packages/auth`, this module is bundled for the
 * browser as well as the worker, and a module-level adapter would pull the whole
 * Better Auth server instance into the client bundle. Server functions — which
 * only ever run on the server — pass one in when they need a mutation. See
 * `server/invitation-binding.ts`.
 */
export type CapabilityBindings = Pick<
  StarterEnv,
  'memberBinding' | 'invitationBinding' | 'lifecycleBinding' | 'userAdminBinding'
>

/** Stripe checkout configuration from the Worker env; `undefined` when unset. */
function stripeBillingConfig(): StarterEnv['billing'] | undefined {
  const secretKey = cloudflareEnv.STRIPE_SECRET_KEY
  if (secretKey === undefined) {
    return undefined
  }
  const priceIds: Record<string, string> = {}
  if (cloudflareEnv.STRIPE_PRICE_ID_TEAM !== undefined) {
    priceIds.team = cloudflareEnv.STRIPE_PRICE_ID_TEAM
  }
  return { secretKey, priceIds }
}

// Real Worker bindings (the same import `auth-runtime.ts` uses). In production the
// D1 binding exists and activates the Live layer; under the local dev shim
// (`cloudflare-workers-shim.ts`) `DB` is undefined and the in-memory Seed
// layer keeps the app working provider-light (CLAUDE.md rule 3). Unset Stripe
// vars leave `billing` off and checkout degrades to `provider_not_configured`.
const stripeBilling = stripeBillingConfig()
let starterEnv: StarterEnv = { DB: cloudflareEnv.DB }
if (stripeBilling !== undefined) {
  starterEnv = { DB: cloudflareEnv.DB, billing: stripeBilling }
}

// The Effect → TanStack boundary. Loaders and server functions are Promise
// returning by contract, so a capability failure has to leave the Effect error
// channel here: TanStack Router consumes `notFound()` as 404 control flow and a
// rejected loader promise as the error-component signal. Every throw below is
// that hand-off, not a swallowed failure.
function rethrowCapabilityFailure(cause: Cause.Cause<unknown>): never {
  const failure = Cause.findErrorOption(cause)
  if (Option.isSome(failure)) {
    const error = failure.value
    if (error instanceof WorkspaceNotFound) {
      // oxlint-disable-next-line effect/noThrowStatement -- `throw notFound()` is TanStack Router's 404 control-flow API
      throw notFound()
    }
    if (error instanceof CapabilityUnavailable) {
      // oxlint-disable-next-line effect/noThrowStatement -- rejects the loader promise so router.tsx's defaultErrorComponent renders the degraded state
      throw new CapabilityUnavailableError(error.capability, error.reason)
    }
    if (error instanceof AuthorizationDenied) {
      // oxlint-disable-next-line effect/noThrowStatement -- carries the 403 across the Promise boundary with a message the calling form can display
      throw new ForbiddenError(error.reason)
    }
    if (error instanceof PlanLimitExceeded) {
      // oxlint-disable-next-line effect/noThrowStatement -- carries the entitlement refusal across the Promise boundary with the upgrade hint the form shows
      throw new PlanLimitError(error.planId, error.limit)
    }
    // oxlint-disable-next-line effect/noThrowStatement -- re-raises the original typed failure across the Promise boundary
    throw error
  }
  // oxlint-disable-next-line effect/noThrowStatement -- re-raises a defect across the Promise boundary
  throw Cause.squash(cause)
}

/**
 * Runs a workspace-scoped capability effect for a route loader or server
 * function.
 *
 * - `actor` is the signed-in user (from `requireSession`); the capabilities
 *   layer verifies workspace membership and fails with `WorkspaceNotFound`
 *   for non-members (non-disclosing). Omit it only for trusted server-side
 *   reads of the public showcase workspace.
 * - `WorkspaceNotFound` becomes TanStack's `notFound()` so routes render the
 *   404 component.
 * - `CapabilityUnavailable` becomes `CapabilityUnavailableError` so the
 *   error component renders a degraded-state message.
 * - `AuthorizationDenied` — raised by `requireWorkspacePermission` inside the
 *   effect — becomes `ForbiddenError`, whose message the calling form shows.
 *
 * `Scope.Scope` is allowed in the effect's requirements because the request
 * scope supplies it: that is how the guard annotates the request's wide event
 * on denial.
 */
export async function runWorkspaceCapabilities<A, E>(
  workspaceSlug: string,
  effect: Effect.Effect<A, E, CapabilityServices | WorkspaceContext | Scope.Scope>,
  actor?: ActorRef,
  bindings?: CapabilityBindings
): Promise<A> {
  const exit = await webRuntime.runPromiseExit(
    withWebRequestScope(
      {
        event: 'capability.workspace',
        metadata: { workspaceSlug, actorUserId: actor?.userId }
      },
      Effect.provide(
        effect,
        selectWorkspaceLayer({ ...starterEnv, ...bindings }, workspaceSlug, actor)
      )
    )
  )
  if (Exit.isSuccess(exit)) {
    return exit.value
  }
  return rethrowCapabilityFailure(exit.cause)
}

/**
 * Runs a capability effect that is not scoped to a single workspace — system
 * surfaces (`/admin`'s global audit log) and cross-workspace projections
 * (`listWorkspacesForUser`). Provides the capability services WITHOUT
 * `WorkspaceContext`; `CapabilityUnavailable` maps to
 * `CapabilityUnavailableError` exactly like `runWorkspaceCapabilities`.
 */
export async function runCapabilities<A, E>(
  effect: Effect.Effect<A, E, CapabilityServices>,
  bindings?: CapabilityBindings
): Promise<A> {
  const exit = await webRuntime.runPromiseExit(
    withWebRequestScope(
      { event: 'capability.global' },
      Effect.provide(effect, selectCapabilitiesLayer({ ...starterEnv, ...bindings }))
    )
  )
  if (Exit.isSuccess(exit)) {
    return exit.value
  }
  return rethrowCapabilityFailure(exit.cause)
}
