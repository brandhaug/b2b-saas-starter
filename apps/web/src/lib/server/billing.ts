import { type Plan } from '@b2b-saas-starter/capabilities/billing/plan-catalog'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'

/**
 * The billing server functions and the billing loader, in a **client-safe**
 * module.
 *
 * This file is statically imported by the billing route and the components
 * it renders, and the route tree ships to the browser — so everything at
 * this module's top level rides on every page. That is why the payload
 * assembly and the checkout wiring (the Billing capability, the plan
 * catalog, the permission helper, the worker env) live in
 * `billing.effects.ts` and are reached only through dynamic `import()`
 * inside each handler: TanStack Start strips handler bodies from the client
 * build, so the capabilities graph never ships, while the payload type
 * still does. The validators are stripped the same way — `.validator()`
 * runs on the server only — so the plain shape checks below are the
 * server's first decode, a wire-shape gate that declares each fn's input
 * type without dragging the Effect Schema chunk onto the route tree, while
 * the strict schemas decode again in the effects file before anything runs.
 */

/**
 * The billing page payload: the workspace's current plan, the catalog, and
 * whether checkout is actually wired. `stripeConfigured` comes from the
 * Billing capability itself — the one definition of "Stripe is configured",
 * the same predicate `startCheckout` enforces — so the page can say "billing
 * is not configured" honestly instead of rendering a button that can only
 * fail.
 */
export type WorkspaceBillingPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly workspaceName: string
  readonly unreadCount: number
  readonly plans: ReadonlyArray<Plan>
  readonly currentPlanId: string
  /** True when the Billing capability has its provider wired. */
  readonly stripeConfigured: boolean
}

type WorkspaceBillingInput = {
  readonly workspaceSlug: string
}

type StartCheckoutInput = {
  readonly workspaceSlug: string
  readonly planId: string
}

type PortalInput = {
  readonly workspaceSlug: string
}

/**
 * The server fns' validators, plain shape checks that run on the server only
 * (TanStack strips `.validator()` from the client build): they are the
 * server's first decode, and the strict schemas decode again in
 * `billing.effects.ts`. These probes ARE the I/O boundary, so `unknown` in
 * and `throw` out is the contract, the same exemption `pickOptionalStrings`
 * carries (lib/utils.ts).
 */
// oxlint-disable anti-slop/no-unknown-parameters
function decodeBillingInput(input: unknown): WorkspaceBillingInput {
  const record = expectRecord(input, 'billing input')
  return { workspaceSlug: expectString(record, 'workspaceSlug', 'billing input') }
}

function decodeCheckoutInput(input: unknown): StartCheckoutInput {
  const record = expectRecord(input, 'billing input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'billing input'),
    planId: expectString(record, 'planId', 'billing input')
  }
}

function decodePortalInput(input: unknown): PortalInput {
  const record = expectRecord(input, 'billing input')
  return { workspaceSlug: expectString(record, 'workspaceSlug', 'billing input') }
}
// oxlint-enable anti-slop/no-unknown-parameters

/** The billing route's loader. */
export const loadWorkspaceBillingServerFn = createServerFn({ method: 'GET' })
  .validator(decodeBillingInput)
  .handler(async ({ data }): Promise<WorkspaceBillingPayload> => {
    const { loadWorkspaceBillingHandler } = await import('./billing.effects')
    return loadWorkspaceBillingHandler(data)
  })

export const startCheckoutServerFn = createServerFn({ method: 'POST' })
  .validator(decodeCheckoutInput)
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { startCheckoutHandler } = await import('./billing.effects')
    return startCheckoutHandler(data)
  })

export const startPortalSessionServerFn = createServerFn({ method: 'POST' })
  .validator(decodePortalInput)
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { startPortalSessionHandler } = await import('./billing.effects')
    return startPortalSessionHandler(data)
  })
