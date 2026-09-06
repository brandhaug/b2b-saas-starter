import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  CapabilityUnavailable,
  MembershipChangeRejected,
  PlanLimitExceeded,
  UserAdminRejected,
  WorkspaceNotFound
} from '@b2b-saas-starter/capabilities/errors'
import { billingOptionsFromEnv } from '@b2b-saas-starter/capabilities/billing/billing.live'
import {
  selectCapabilitiesLayer,
  selectWorkspaceContextLayer,
  type StarterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import {
  type ActorRef,
  type WorkspaceContext
} from '@b2b-saas-starter/capabilities/workspace-context'
import { type CapabilityServices } from '@b2b-saas-starter/capabilities/layers'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { notFound } from '@tanstack/react-router'
import { type Context, Cause, Effect, Exit, Layer, Option, type Scope } from 'effect'

import {
  CapabilityUnavailableError,
  ForbiddenError,
  MembershipRefusedError,
  PlanLimitError,
  UserAdminRefusedError
} from './capability-error'
import { memoizePerRequest, webRuntime, withWebRequestScope } from './observability'

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
 *
 * Per call also means per memo slot: {@link capabilitiesServices} keys the
 * per-request build on which adapters were passed, so a mutation never reuses
 * the shared read-only services, and vice versa.
 */
export type CapabilityBindings = Pick<
  StarterEnv,
  | 'memberBinding'
  | 'invitationBinding'
  | 'lifecycleBinding'
  | 'userAdminBinding'
  | 'ssoBinding'
  | 'accountLifecycleBinding'
>

// Real Worker bindings (the same import `auth-runtime.ts` uses). In production the
// D1 binding exists and activates the Live layer; under the local dev shim
// (`cloudflare-workers-shim.ts`) `DB` is undefined and the in-memory Seed
// layer keeps the app working provider-light (CLAUDE.md rule 3). The Stripe
// options come from the shared env mapping — unset vars leave `billing` off
// and checkout degrades to `provider_not_configured`; an unwired
// `BILLING_QUEUE` leaves seat sync to the provider webhooks. The export
// bindings (ADR 0055) ride along the same way: absent under the shim and in
// an unconfigured deploy, present when alchemy provisioned them.
const starterEnv: StarterEnv = {
  DB: cloudflareEnv.DB,
  BILLING_QUEUE: cloudflareEnv.BILLING_QUEUE,
  WORKSPACE_EXPORT_QUEUE: cloudflareEnv.WORKSPACE_EXPORT_QUEUE,
  WORKSPACE_EXPORT_BUCKET: cloudflareEnv.WORKSPACE_EXPORT_BUCKET,
  NOTIFICATION_EMAIL_QUEUE: cloudflareEnv.NOTIFICATION_EMAIL_QUEUE,
  billing: billingOptionsFromEnv(cloudflareEnv)
}

/**
 * The binding fields a caller may pass per call, declared once so the memo key
 * below cannot drift from {@link CapabilityBindings}: a field added there
 * without a row here would silently fold two different adapters onto one
 * per-request slot.
 */
const BINDING_FIELDS = [
  'memberBinding',
  'invitationBinding',
  'lifecycleBinding',
  'userAdminBinding',
  'ssoBinding',
  'accountLifecycleBinding'
] satisfies ReadonlyArray<keyof CapabilityBindings>

/**
 * Stable per-object ids for that key. A binding is an opaque bag of plugin
 * call closures, so object identity — not structure — is the honest
 * discriminator: two calls passing the same adapter (every server fn imports
 * its binding from a module, so this is the norm) share one slot, while two
 * different adapters never share a layer. The map names objects; it holds no
 * services, so nothing here outlives a request.
 */
type AnyCapabilityBinding = NonNullable<CapabilityBindings[keyof CapabilityBindings]>

const bindingSlotIds = new WeakMap<AnyCapabilityBinding, number>()
let nextBindingSlotId = 1

function bindingSlotId(binding: AnyCapabilityBinding): number {
  const known = bindingSlotIds.get(binding)
  if (known !== undefined) {
    return known
  }
  const id = nextBindingSlotId
  nextBindingSlotId += 1
  bindingSlotIds.set(binding, id)
  return id
}

/**
 * One memo slot name per distinct set of plugin bindings. Read-only calls —
 * every loader — pass none and land on one shared slot; a mutation selects its
 * own, so the layer built around one call's adapters is never reused for
 * another's.
 */
function capabilitiesMemoKey(bindings: CapabilityBindings | undefined): string {
  if (bindings === undefined) {
    return 'capabilities.services:none'
  }
  const slots = BINDING_FIELDS.flatMap((field) => {
    const binding = bindings[field]
    return binding === undefined ? [] : [`${field}:${bindingSlotId(binding)}`]
  })
  return slots.length === 0
    ? 'capabilities.services:none'
    : `capabilities.services:${slots.join('+')}`
}

/**
 * The selected capability services, built once per request and shared by every
 * Effect run in it: the merged live graph is 17 layers plus a drizzle client,
 * and one page load fans out into several loader runs that all need the same
 * one. `memoizePerRequest` is the sanctioned home — slots live on the
 * request's telemetry, so concurrent requests on one isolate never share a
 * build. That is deliberately not the API worker's isolate-level layer
 * (`apps/api/src/http.ts`): these services cannot be hoisted out of the
 * request, because their plugin-backed adapters arrive per call.
 *
 * What is memoized is the built `Context`, not the `Layer` value — Effect
 * memoizes layer construction per memo map, and sibling runs each bring their
 * own, so only a shared context actually crosses the run boundary. The scope
 * the build runs in closes when the build completes; no layer in this graph
 * registers finalizers (plain constructors across `capabilities`,
 * `db/service`, and the drizzle D1 drivers), so the services outlive that
 * close for the rest of the request. A layer that needs `acquireRelease` must
 * not join this context without revisiting that. Outside a request — unit
 * tests, scripts, client-side navigations — there is no slot to dedupe
 * against, so every call builds its own, exactly as before.
 */
function capabilitiesServices(
  bindings?: CapabilityBindings
): Promise<Context.Context<CapabilityServices>> {
  return memoizePerRequest(capabilitiesMemoKey(bindings), () =>
    webRuntime.runPromise(
      Effect.scoped(
        Layer.build(selectCapabilitiesLayer({ ...starterEnv, ...bindings }))
      )
    )
  )
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
    if (error instanceof MembershipChangeRejected) {
      // oxlint-disable-next-line effect/noThrowStatement -- carries the refusal's explanation across the Promise boundary: past it only name/message survive, and the typed reason does not
      throw new MembershipRefusedError(error.reason)
    }
    if (error instanceof UserAdminRejected) {
      // oxlint-disable-next-line effect/noThrowStatement -- carries the /admin refusal's explanation across the Promise boundary, on the same name/message-only terms
      throw new UserAdminRefusedError(error.reason)
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
 * - The capability services come from the once-per-request build ({@link
 *   capabilitiesServices}); the `WorkspaceContext` layer is provided per
 *   call, because it is the one service that depends on this request's slug
 *   and actor — the same split `selectWorkspaceContextLayer` documents.
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
  const services = await capabilitiesServices(bindings)
  const exit = await webRuntime.runPromiseExit(
    withWebRequestScope(
      {
        event: 'capability.workspace',
        metadata: { workspaceSlug, actorUserId: actor?.userId }
      },
      Effect.provide(
        Effect.provide(
          effect,
          selectWorkspaceContextLayer(
            { ...starterEnv, ...bindings },
            workspaceSlug,
            actor
          )
        ),
        services
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
 * `WorkspaceContext`, from the same once-per-request build
 * {@link runWorkspaceCapabilities} rides on; `CapabilityUnavailable` maps to
 * `CapabilityUnavailableError` exactly like `runWorkspaceCapabilities`.
 */
export async function runCapabilities<A, E>(
  effect: Effect.Effect<A, E, CapabilityServices>,
  bindings?: CapabilityBindings
): Promise<A> {
  const services = await capabilitiesServices(bindings)
  const exit = await webRuntime.runPromiseExit(
    withWebRequestScope(
      { event: 'capability.global' },
      Effect.provide(effect, services)
    )
  )
  if (Exit.isSuccess(exit)) {
    return exit.value
  }
  return rethrowCapabilityFailure(exit.cause)
}
