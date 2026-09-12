import { Billing, type ReconcileResult } from '@b2b-saas-starter/billing/billing'
import { ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { seatUsage } from '@b2b-saas-starter/billing/plan-catalog'
import { Effect } from 'effect'
import { env as cloudflareEnv } from 'cloudflare:workers'

import { runCapabilities, runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission, whenPermitted } from './authorize'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'
import {
  type PortalInput,
  type StartCheckoutInput,
  type WorkspaceBillingInput,
  type WorkspaceBillingPayload,
  type SelectResourcesInput,
  type PublicPricingPayload
} from './billing'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

/**
 * The billing payload assembly and the checkout wiring, reached only
 * through dynamic `import()` inside the handlers of `billing.ts`: handler
 * bodies are stripped from the client build, so this graph ships to the
 * server alone. `billing.ts` holds the client-safe half and the reason for
 * the split.
 */

/** The billing route's loader effect. Hard-gated like the other pages. */
const billingPayload: WorkspacePageFrame<WorkspaceBillingPayload> = workspacePage(
  { notification: ['read'] },
  (ctx) =>
    Effect.flatMap(Billing, (billing) =>
      Effect.map(
        Effect.all(
          {
            unreadCount,
            plan: billing.currentPlan,
            members: Effect.flatMap(
              WorkspaceMembership,
              (membership) => membership.listMembers
            ),
            stripeConfigured: billing.configured,
            synchronization: billing.synchronizationStatus,
            lifecycle: billing.lifecycleStatus,
            plans: Effect.match(billing.displayedPlans, {
              onFailure: () => null,
              onSuccess: (plans) => plans
            }),
            resourceSelection: Effect.flatMap(ResourceEntitlements, (resources) =>
              resources.getSelection()
            ),
            apiTokenEntitlements: Effect.flatMap(ResourceEntitlements, (resources) =>
              resources.summarize({ resource: 'api_token' })
            ),
            webhookEntitlements: Effect.flatMap(ResourceEntitlements, (resources) =>
              resources.summarize({ resource: 'webhook_endpoint' })
            ),
            apiTokens: whenPermitted(
              { apiToken: ['list'] },
              Effect.flatMap(ApiTokenRegistry, (registry) => registry.list)
            ),
            webhookEndpoints: whenPermitted(
              { webhook: ['list'] },
              Effect.flatMap(WebhookEndpoints, (webhooks) => webhooks.list)
            )
          },
          { concurrency: 'unbounded' }
        ),
        (segments) => {
          const apiTokenIds = new Set(segments.apiTokenEntitlements.eligibleIds)
          const webhookEndpointIds = new Set(segments.webhookEntitlements.eligibleIds)
          return {
            workspaceName: ctx.workspace.name,
            unreadCount: segments.unreadCount,
            plans: segments.plans ?? [],
            pricingUnavailable: segments.plans === null,
            currentPlanId: segments.plan.id,
            seatUsage: seatUsage(segments.plan, segments.members.length),
            stripeConfigured: segments.stripeConfigured,
            synchronization: segments.synchronization,
            lifecycle: segments.lifecycle,
            resourceSelection: segments.resourceSelection,
            apiTokens:
              segments.apiTokens?.reduce<
                Array<{ readonly id: string; readonly name: string }>
              >((eligible, { id, name }) => {
                if (apiTokenIds.has(id)) {
                  eligible.push({ id, name })
                }
                return eligible
              }, []) ?? [],
            webhookEndpoints:
              segments.webhookEndpoints?.reduce<
                Array<{ readonly id: string; readonly url: string }>
              >((eligible, { id, url }) => {
                if (webhookEndpointIds.has(id)) {
                  eligible.push({ id, url })
                }
                return eligible
              }, []) ?? [],
            resourceEntitlements: {
              apiTokens: segments.apiTokenEntitlements,
              webhookEndpoints: segments.webhookEntitlements
            }
          }
        }
      )
    )
)

export async function loadWorkspaceBillingHandler(
  input: WorkspaceBillingInput
): Promise<WorkspaceBillingPayload> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(input.workspaceSlug, billingPayload, {
    userId: session.user.id
  })
}

export async function selectBillingResourcesHandler(
  input: SelectResourcesInput
): Promise<{
  readonly apiTokenIds: ReadonlyArray<string>
  readonly webhookEndpointIds: ReadonlyArray<string>
}> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ organization: ['update'] })
      const resources = yield* ResourceEntitlements
      return yield* resources.select({
        apiTokenIds: input.apiTokenIds,
        webhookEndpointIds: input.webhookEndpointIds
      })
    }),
    { userId: session.user.id }
  )
}

export async function loadPublicPricingHandler(): Promise<PublicPricingPayload> {
  return runCapabilities(
    Effect.flatMap(Billing, (billing) =>
      Effect.map(
        Effect.all(
          {
            plans: Effect.match(billing.displayedPlans, {
              onFailure: () => null,
              onSuccess: (plans) => plans
            }),
            stripeConfigured: billing.configured
          },
          { concurrency: 'unbounded' }
        ),
        (value) => ({
          plans: value.plans ?? [],
          pricingUnavailable: value.plans === null,
          stripeConfigured: value.stripeConfigured
        })
      )
    )
  )
}

/**
 * The upgrade action below the session and permission gates. Redirect URLs
 * are composed server-side from the configured base URL — the client names
 * only its slug and the plan — so a crafted success/cancel URL cannot turn
 * the checkout handoff into an open redirect.
 */
export async function startCheckoutHandler(
  input: StartCheckoutInput
): Promise<{ url: string }> {
  const session = await requireRequestSession()
  const base = cloudflareEnv.BETTER_AUTH_URL.replace(/\/$/, '')
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission(
        { organization: ['update'] },
        'billing_recovery'
      )
      const billing = yield* Billing
      const backTo = `${base}/workspaces/${encodeURIComponent(input.workspaceSlug)}/billing`
      return yield* billing.startCheckout({
        planId: input.planId,
        successUrl: `${backTo}?checkout=success`,
        cancelUrl: `${backTo}?checkout=canceled`
      })
    }),
    { userId: session.user.id }
  )
}

/**
 * The "Manage billing" action below the session and permission gates. The
 * return URL is composed server-side from the configured base URL — same
 * open-redirect posture as checkout — and the portal itself owns invoices,
 * payment method, and cancellation.
 */
export async function startPortalSessionHandler(
  input: PortalInput
): Promise<{ url: string }> {
  const session = await requireRequestSession()
  const base = cloudflareEnv.BETTER_AUTH_URL.replace(/\/$/, '')
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission(
        { organization: ['update'] },
        'billing_recovery'
      )
      const billing = yield* Billing
      return yield* billing.startPortalSession({
        returnUrl: `${base}/workspaces/${encodeURIComponent(input.workspaceSlug)}/billing`
      })
    }),
    { userId: session.user.id }
  )
}

/** Re-check the authenticated workspace after Stripe sends the browser back. */
export async function reconcileCheckoutReturnHandler(
  input: WorkspaceBillingInput
): Promise<ReconcileResult> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ organization: ['update'] })
      const context = yield* WorkspaceContext
      const billing = yield* Billing
      return yield* billing
        .reconcileWorkspace({
          workspaceId: context.workspace.id,
          reason: 'checkout_return'
        })
        .pipe(
          Effect.timeout('8 seconds'),
          Effect.catchTag('TimeoutError', () =>
            Effect.fail(
              new CapabilityUnavailable({
                capability: 'billing',
                reason: 'reconciliation_timeout'
              })
            )
          )
        )
    }),
    { userId: session.user.id }
  )
}
