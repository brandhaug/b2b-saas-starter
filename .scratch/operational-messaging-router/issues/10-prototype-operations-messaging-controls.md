# Prototype Operations Messaging Controls

Type: prototype
Status: resolved
Blocked by: 04, 06, 07, 08

## Question

What is the smallest safe Operations App interaction for versioned rate cards, audited credit adjustments, masked cross-Merchant search, routing and delivery diagnostics, provider cost versus Merchant charge, callback and reconciliation evidence, complaint investigation, and audited WhatsApp and SMSO.ro kill switches without exposing reusable credentials or making Operators a Merchant authority?

## Comments

### Resolution — 2026-07-28

The Operations messaging surface uses a **case queue as its primary daily-work model**. A compact health summary above the queue shows delivery, ambiguity, provider-cost-versus-Merchant-charge, reconciliation, and complaint signals without turning the overview into a mutation surface. Cross-Merchant search accepts internal Notification Intent and Submission Attempt identifiers, Merchant identity, or the last three digits of a protected destination; results and case rows show only the Merchant, masked destination, purpose, age, and safe normalized state.

Selecting a case opens one focused investigation workspace. It presents the ordered route journey, append-only normalized Provider Evidence, reservation and Chargeable Delivery facts, provider cost beside Merchant charge, reconciliation state, and linked complaint activity. It never displays rendered message bodies, Confirmation URLs, reusable provider references, raw requests or callbacks, credentials, or unmasked destinations. Routine investigation uses `messaging:read`; authoritative provider queries and classified reconciliation resolutions require `messaging:reconcile`. An Operator appends a resolution and its source rather than editing evidence.

Privileged platform mutations do not sit beside routine case actions. Dedicated **Containment** and **Finance** workspaces separate them from investigation:

- Containment shows current per-environment channel posture and offers the narrowest effective action first: freeze one Merchant, pause one provider/channel, or stop global messaging. Actions require `messaging:control` or `messaging:incident` as appropriate. Global re-enable and compromised-credential recovery require the already-settled two-person approval, reconciliation, health probes, and residual-risk record.
- Finance shows immutable effective-dated Rate Card versions, current and future drafts, and provider cost versus realized Merchant charge. Audited credit or debit correction requires `messaging:finance` and appends a compensating Messaging Balance entry; it never edits prior ledger history.

Every sensitive command rechecks current authoritative Operator Permission and then uses one consistent guardrail: explicit environment/provider/Merchant scope, safe before/after preview, required substantive reason, confirmation, and an audit committed atomically with the accepted mutation. Merchant impersonation cannot perform messaging controls, financial corrections, reconciliation, incident actions, or protected-data access. Operators never become Merchant authorities and cannot act through Merchant product commands.

The approved composition is the case-queue structure from Variant B, the dedicated Containment and Finance modes from Variant C, and the compact health summary from Variant A. The throwaway route was deleted after this decision; the comparison remains in the prototype assets:

- [Variant A — Signal board](../artifacts/operations-messaging-controls/variant-a-signal-board.png)
- [Variant B — Case queue](../artifacts/operations-messaging-controls/variant-b-case-queue.png)
- [Variant C — Evidence workbench](../artifacts/operations-messaging-controls/variant-c-evidence-workbench.png)

Exact projection schemas, Effect contracts, audit event shapes, permission bundles, confirmation components, accessibility behavior, and implementation slices remain with the verification and implementation-program tickets. No new ticket or fog graduation is required from this resolution.
