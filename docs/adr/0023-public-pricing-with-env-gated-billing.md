# Public pricing with env-gated billing

The public pricing page renders the shared plan offers without requiring a payment provider. Checkout, portal access, and lifecycle controls belong to the authenticated workspace and require billing configuration for provider actions. Configured deployments show verified provider prices or an unavailable state; provider-light demonstrations may use clearly labeled catalog examples. Billing state and entitlement policy follow [ADR 0060](./0060-durable-seat-based-billing.md) and [ADR 0076](./0076-billing-lifecycle-and-entitlement-decisions.md).

Public self-service plan links carry a typed purchase intent to `/purchase`.
The intent contains only the catalog plan identifier. Sign-in, signup, email
verification, and privileged-factor management preserve its same-origin return
path. The purchase page lists only workspaces whose current membership permits
billing management and offers the existing workspace-creation flow. Required
email verification follows the production policy; local use remains provider-light.

Selecting or creating a workspace opens its billing page with the selected plan.
The existing workspace gate requires privileged authentication. An explicit
confirmation calls the existing checkout handler, which rechecks membership,
authority, suspension, and authentication before Billing resolves the Stripe price
and current Seat Quantity. Existing subscriptions follow the portal policy.
Navigation, refresh, and Back never create a checkout. Cancel exits to pricing;
new provider checkout cancellations return to the selected plan. Durable retries
retain the original claim inputs, including return URLs.
