import { AuthorizationDenied } from '@b2b-saas-starter/authz/src/errors.ts'
import {
  CapabilityUnavailable,
  WorkspaceNotFound
} from '@b2b-saas-starter/capabilities/src/errors.ts'
import {
  selectCapabilitiesLayer,
  selectWorkspaceLayer,
  type StarterEnv
} from '@b2b-saas-starter/capabilities/src/runtime.ts'
import {
  type ActorRef,
  type WorkspaceContext
} from '@b2b-saas-starter/capabilities/src/workspace-context.ts'
import { type CapabilityServices } from '@b2b-saas-starter/capabilities/src/layers.ts'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { notFound } from '@tanstack/react-router'
import { Cause, Effect, Exit, Option, type Scope } from 'effect'

import { CapabilityUnavailableError, ForbiddenError } from './capability-error'
import { withWebRequestScope } from './observability'

export type { CapabilityServices }
export { CapabilityUnavailableError, ForbiddenError }

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
  'memberBinding' | 'invitationBinding' | 'lifecycleBinding'
>

// Real Worker bindings (same import as `server-context.ts`). In production the
// D1 binding exists and activates the Live layer; under the local dev shim
// (`cloudflare-workers-shim.ts`) `DB` is undefined and the in-memory Seed
// layer keeps the app working provider-light (CLAUDE.md rule 3).
//
const starterEnv: StarterEnv = {
  DB: cloudflareEnv.DB
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
    // oxlint-disable-next-line effect/noThrowStatement -- `throw notFound()` is TanStack Router's 404 control-flow API
    if (error instanceof WorkspaceNotFound) throw notFound()
    if (error instanceof CapabilityUnavailable) {
      // oxlint-disable-next-line effect/noThrowStatement -- rejects the loader promise so router.tsx's defaultErrorComponent renders the degraded state
      throw new CapabilityUnavailableError(error.capability, error.reason)
    }
    if (error instanceof AuthorizationDenied) {
      // oxlint-disable-next-line effect/noThrowStatement -- carries the 403 across the Promise boundary with a message the calling form can display
      throw new ForbiddenError(error.reason)
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
  const exit = await Effect.runPromiseExit(
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
  if (Exit.isSuccess(exit)) return exit.value
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
  const exit = await Effect.runPromiseExit(
    withWebRequestScope(
      { event: 'capability.global' },
      Effect.provide(effect, selectCapabilitiesLayer({ ...starterEnv, ...bindings }))
    )
  )
  if (Exit.isSuccess(exit)) return exit.value
  return rethrowCapabilityFailure(exit.cause)
}
