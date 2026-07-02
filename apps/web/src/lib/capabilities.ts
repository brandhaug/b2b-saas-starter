import { env as cloudflareEnv } from 'cloudflare:workers'
import { notFound } from '@tanstack/react-router'
import { Cause, Effect, Exit, Option } from 'effect'
import {
  CapabilityUnavailable,
  selectCapabilitiesLayer,
  selectWorkspaceLayer,
  WorkspaceNotFound,
  type ActorRef,
  type CapabilityServices,
  type StarterEnv,
  type WorkspaceContext
} from '@b2b-saas-starter/capabilities'
import { makeStarterEnvModuleConfig } from '@b2b-saas-starter/env'
import { CapabilityUnavailableError } from './capability-error'

export type { CapabilityServices }
export { CapabilityUnavailableError }

// Real Worker bindings (same import as `server-context.ts`). In production the
// D1 binding exists and activates the Live layer; under the local dev shim
// (`cloudflare-workers-shim.ts`) `DB` is undefined and the in-memory Seed
// layer keeps the app working provider-light (CLAUDE.md rule 3).
//
// `moduleConfig` runs the module-aware env validation (ADR 0035) over the
// worker's real env: optional modules with unset vars surface as
// needs-config in the workspace UI instead of trusting stored fixture state.
// `makeStarterEnvModuleConfig` never throws in local mode, so an empty env
// still boots.
const starterEnv: StarterEnv = {
  DB: cloudflareEnv.DB,
  // Spread: `Env` is an interface (no implicit index signature), so it is not
  // directly assignable to the `Record<string, unknown>` parameter.
  moduleConfig: makeStarterEnvModuleConfig({ ...cloudflareEnv })
}

const rethrowCapabilityFailure = (cause: Cause.Cause<unknown>): never => {
  const failure = Cause.findErrorOption(cause)
  if (Option.isSome(failure)) {
    const error = failure.value
    if (error instanceof WorkspaceNotFound) throw notFound()
    if (error instanceof CapabilityUnavailable) {
      throw new CapabilityUnavailableError(error.capability, error.reason)
    }
    throw error
  }
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
 */
export const runWorkspaceCapabilities = async <A, E>(
  workspaceSlug: string,
  effect: Effect.Effect<A, E, CapabilityServices | WorkspaceContext>,
  actor?: ActorRef
): Promise<A> => {
  const exit = await Effect.runPromiseExit(
    Effect.provide(effect, selectWorkspaceLayer(starterEnv, workspaceSlug, actor))
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
export const runCapabilities = async <A, E>(
  effect: Effect.Effect<A, E, CapabilityServices>
): Promise<A> => {
  const exit = await Effect.runPromiseExit(
    Effect.provide(effect, selectCapabilitiesLayer(starterEnv))
  )
  if (Exit.isSuccess(exit)) return exit.value
  return rethrowCapabilityFailure(exit.cause)
}
