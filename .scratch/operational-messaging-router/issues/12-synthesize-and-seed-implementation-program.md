# Synthesize and Seed the Implementation Program

Type: task
Status: resolved
Blocked by: 11

## Question

After the research, domain, financial, architectural, security, interaction, and verification decisions resolve, what dependency-ordered tracer-bullet implementation tickets should be added to this map to build console/fake providers and deterministic contract fixtures first; migrate D1; implement Effect capabilities and real-provider adapters; extend queue, callback, and reconciliation infrastructure; build Merchant and Operations surfaces; create templates; integrate top-ups; then unblock live external-account provisioning and capped qualification so Operational Messaging can be available to every eligible Romanian Merchant with the Booking Product launch, with safe compatibility, cutover, containment, recovery, and reconciliation?

## Comments

### Resolution — 2026-07-29

The implementation program now adds 16 dependency-ordered tracer-bullet tickets and rewires the two existing live-route qualification tickets into the same acyclic graph. Each slice owns an independently demonstrable behavior through the D1, Effect, adapter, Worker or actor surface and its focused verification; the program does not create horizontal “all schema,” “all UI,” or “all tests” phases that defer integration risk.

The route is:

1. [Establish the Deterministic Provider Contract Harness](./16-establish-deterministic-provider-contract-harness.md) is the sole initial frontier. It gives every later provider, lifecycle, callback, load and failure path one redacted deterministic vocabulary without treating capture as delivery.
2. [Expand D1 for Operational Messaging](./17-expand-d1-for-operational-messaging.md) follows the harness and expands the durable model without switching producers, replaying history, or breaking old application versions.
3. [Implement the Controlled Template and Eligibility Engine](./18-implement-controlled-template-and-eligibility-engine.md) and [Implement Messaging Balance and the Rate Card](./19-implement-messaging-balance-and-rate-card.md) branch from the D1 foundation so content/eligibility and exact financial authority can be proven independently.
4. [Implement the Notification Intent Lifecycle](./20-implement-notification-intent-lifecycle.md) joins those branches into the complete monotonic WhatsApp-first/SMS-fallback aggregate and its Effect seams.
5. [Integrate Booking Intent Producers and Cut Over Mobile Work](./21-integrate-booking-intent-producers-and-cutover.md) composes opaque intent preparation into Booking transactions, introduces compatible PII-free wake-ups, migrates only safe future reminders, and contracts the legacy mobile outbox path after replacement proof.
6. [Execute Intents with Queue Recovery and Fake Providers](./22-execute-intents-with-queue-recovery-and-fakes.md) completes the provider-free vertical slice through the existing Queue, Background Worker, leases, write-ahead attempts, durable recovery and fake evidence.
7. [Implement the WhatsApp Adapter and Callback Edge](./23-implement-whatsapp-adapter-and-callback-edge.md) and [Implement the SMSO.ro Adapter, Callback Hint, and Polling](./24-implement-smso-adapter-callback-and-polling.md) then replace the fake boundary in parallel while retaining explicit needs-configuration and deterministic contract proof.
8. [Implement Reconciliation, Retention, and Containment](./25-implement-reconciliation-retention-and-containment.md) joins both real-provider branches with the financial and lifecycle cores to deliver ambiguity closure, evidence reconciliation, crypto-erasure, scoped freezes, kill switches, incidents and guarded recovery.
9. [Deliver Booking Disclosure and Merchant Messaging Settings](./26-deliver-booking-disclosure-and-merchant-settings.md), [Deliver Merchant Balance, Top-Ups, and Delivery Recovery](./27-deliver-merchant-balance-topups-and-recovery.md), and [Deliver Operations Messaging Workspaces](./28-deliver-operations-messaging-workspaces.md) expose the approved actor journeys through narrow capability projections. Top-ups additionally wait for [Finalize Messaging Governance and Fiscal Readiness](./30-finalize-messaging-governance-and-fiscal-readiness.md), so VAT, invoice and refund behavior is not invented in code.
10. [Harden the Production Runtime and Operability](./29-harden-production-runtime-and-operability.md) creates the callback, queue, cron, secret/configuration, observability, load, compatibility and recovery environment required before external accounts are connected.
11. [Provision and Qualify the SMSO.ro Seed Route](./13-provision-and-qualify-smso-ro-seed-route.md) now waits for the SMS adapter, reconciliation/containment, and production-like runtime. [Provision and Qualify the WhatsApp Production Route](./15-provision-and-qualify-whatsapp-production-route.md) now waits for the existing console-capture safety slice plus controlled templates, the Meta adapter/callback edge, reconciliation/containment, and the production-like runtime. Their temporary dependency on this synthesis ticket has been replaced with those exact prerequisites.
12. [Prove the Messaging Launch Gate and Enable Operational Messaging](./31-prove-launch-gate-and-enable-operational-messaging.md) is the only terminal launch ticket. It joins both qualified providers, both actor surfaces, governance/fiscal readiness, production operability and the full automated/load/tabletop/16-message evidence matrix before enabling every eligible Romanian Merchant without an allowlist or observation delay.

All blocker references resolve and the graph is acyclic. While the provider branches and actor-surface branches later permit parallel work, the first implementation frontier intentionally contains only [Establish the Deterministic Provider Contract Harness](./16-establish-deterministic-provider-contract-harness.md). Each implementation ticket should be executed with the map’s required `implement` workflow, TDD at pre-agreed seams, regular focused checks, a final full suite, code review, and a commit.
