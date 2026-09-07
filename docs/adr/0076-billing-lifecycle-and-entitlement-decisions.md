# Billing lifecycle and entitlement decisions

Date: 2026-09-07

Issue #284 completes the access decision that durable synchronization leaves
behind. The provider subscription identifies the workspace's Subscribed Plan.
The Effective Plan is the plan whose entitlements apply at the time of a
request. Keeping those concepts separate lets the application preserve a
subscription during recovery without granting access after a verified
deadline.

## Decision

Billing synchronization verifies the current provider subscription, its
recognized price, payment evidence, period, and cancellation state before it
updates local state. The same lifecycle decision runs on every plan read used
for creation, credential verification, API/MCP authorization, and webhook
dispatch. It uses the current time and the last verified state, so an outage
cannot extend a deadline merely because reconciliation has not run.

An incomplete first payment does not grant paid access. An operator-created
trial grants its subscribed plan through the verified trial end, and an
unconverted trial returns to Starter without renewal grace. For a previously
paying subscription, the first failed renewal starts a fixed seven-day grace
deadline. Provider retries do not move it. A verified `unpaid` or `canceled`
state ends paid access sooner; a verified successful payment restores the
Subscribed Plan. Recovery never clears a separate administrative suspension.

Stripe remains the place for payment collection, retry scheduling, invoice and
payment-method changes, refunds, and cancellation. Period-end cancellation
retains access through the paid period and can be undone before it takes
effect. An immediate provider cancellation takes effect when verified.

## Resource entitlements

Returning to Starter is non-destructive. The soft three-member rule explains
the overage without removing or blocking Members. API Tokens and Webhook
Endpoints that exceed Starter limits remain stored. An owner or admin selects
two token slots and one webhook slot for the category. Until a required choice
exists, that category is paused. The selection is checked at creation,
verification, authorization, and queued webhook dispatch, including for
existing credentials and queued work.

Selections refer to current eligible resources and follow token replacement or
other resource changes through the capability's shared Seed and Live
behavior. Selection changes are audited. The selection boundary validates
workspace ownership and the Starter limit, while the resource capabilities
retain responsibility for creating and storing resources.

## Communication and recovery controls

Owners and admins receive payment-failure, approaching-grace-expiry, and
successful-recovery notices. Notice delivery is an independently retryable
step after the lifecycle and audit/outbox commit, so a notice-store or email
failure cannot prevent a newer verified payment state from being recorded.
Other Members receive an access explanation and a prompt to contact an
owner/admin without invoice or payment-method details.

The Billing Portal remains the recovery path for authorized owners/admins even
when paid product access is restricted. The workspace billing read loads the
lifecycle and recovery controls independently of optional displayed-price
lookup. In configured mode, an unavailable or invalid provider price is shown
as unavailable and does not become catalog example pricing. Provider-light
local mode may show clearly labeled catalog examples.

## Consequences

The effective-plan decision is shared by Seed and Live and must not be
recreated from `WorkspaceContext.workspace.planId` or raw provider status in a
caller. Stored subscription data can name a plan that is temporarily not
effective. That is intentional, and the billing UI should explain the current
effective state rather than infer it from one raw status field.

This decision does not add an app-managed trial offering, annual or usage
pricing, manual entitlement overrides, or automatic deletion on downgrade.
