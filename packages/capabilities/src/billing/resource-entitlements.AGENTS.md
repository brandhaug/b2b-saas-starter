# Resource entitlements

Creation admission and execution use Billing's request-time plan, including deadlines. Keep `plan-catalog.ts` pure; workspace context proves identity, not current paid access.

## Contracts and ownership

- Selection reads decode persisted rows and project current eligible IDs. Unknown or foreign mutation inputs fail with `ResourceSelectionRejected`; known unavailable IDs disappear from editable selections. A stale token parent in a pending save resolves to its current replacement. Deleted IDs disappear from reads and are rejected if submitted again.
- Owner selection writes batch with `billing.resource_selection_updated` and invocation provenance. Token rotation's selected-slot statement belongs to this module and commits with the token claim and replacement audit. Never compute a replacement array from a pre-batch read: independent rotations and selection saves must compose against current database state.
- The named Seed inventory layer shares current adapter inventories, workspace-keyed selection state, and the token/selection mutation semaphore. Reuse that exact layer value; copying fixtures into an entitlement adapter freezes eligibility and breaks resources created later. Inventory registration happens during adapter acquisition, avoiding a selection-to-registry layer cycle.
- Dispatch checks enabled endpoints, and token authority counts current unrevoked, unexpired leaves. Over-limit categories require selection; disabling, deletion, expiry and rotation must also update what selection reads expose. Preserve stored excess resources.
