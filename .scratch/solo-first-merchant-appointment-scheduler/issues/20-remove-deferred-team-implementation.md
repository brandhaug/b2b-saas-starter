# Remove Deferred Team Implementation

Type: task
Status: resolved
Blocked by:

## Question

Remove the already-added Merchant Team Plan implementation so BeeSolo ships one Solo entitlement, one Merchant Owner, one Shop, and one active Owner-Provider without dormant Team branches, while preserving the Provider-based scheduling, authorization, historical-data, Operations, and booking-correctness invariants BeeSolo still needs.

## Scope

- Contract `MerchantPlan`, Merchant context, onboarding, catalog projections, and presentation contracts from `solo | team` to BeeSolo's single Solo behavior. Remove Team selection and plan-switch code rather than hiding it behind an unreachable flag.
- Remove Team plan cards, comparison and alternate-plan state, per-seat or Team copy, Team catalog destinations, additional-Provider administration, Provider/status filters introduced for Team, and Team-specific responsive navigation from the Public Site and Merchant App.
- Remove Merchant Catalog commands whose only purpose is creating or administering additional Team Providers. Keep the automatically created Owner-Provider, its editable Solo profile, Service eligibility, Schedule Rules, historical Provider facts, and all cross-Merchant constraints.
- Simplify the Booking App's Team presentation branch. BeeSolo must not offer Provider Preference, Specific Provider, Any Provider, or multi-Provider selection UI; every launch Booking Request resolves to the sole eligible Owner-Provider while retaining conflict-safe holds, immutable Appointment snapshots, and non-disclosing errors.
- Remove Team onboarding scenarios, fixtures, parity scenarios/evidence, browser variants, and unit/integration expectations. Replace them with Solo assertions proving Team copy, controls, routes, and mutation paths are absent.
- Add a forward-only D1 migration for any Team-specific plan constraint or persisted facts. Before contracting storage, inventory existing `team` Merchants and additional Providers. Never silently collapse production data: fail with a documented operator precondition if incompatible rows exist; only deterministic development/test fixtures may be recreated automatically.
- Remove now-dead exports, schemas, route inputs, generated fixture fields, and documentation references discovered by typecheck and repository search.

## Preserve

- `merchant_memberships` and its single Owner relationship: it remains BeeSolo's authorization source and an Operations impersonation target.
- The Provider entity, Provider Status, Provider-Service eligibility, Schedule Rules, Appointment Provider snapshots, and historical Provider references required by the sole Owner-Provider model.
- System Operator roles such as `operator-manager`, Operator Invitations and enrollment, Operations App permissions, and Operations audit behavior. These are platform-staff authority, not Merchant Team Plan implementation.
- Generic use of the words “team” or “manager” in third-party provider accounts, engineering process, or historical migration files when it does not grant Merchant Team behavior. Never rewrite an already-applied migration; add a new forward migration.

## Acceptance criteria

- BeeSolo has no runtime `team` Merchant plan value, Team plan selection, Team pricing card, Team upgrade/downgrade action, per-seat quantity, Merchant Manager or Employee role, Merchant invitation, additional-Provider creation path, Team Provider filter, or Team-specific schedule layout.
- A verified Owner still onboards atomically with one Merchant, one Owner Membership, one Shop, and one active Owner-Provider; the Owner-Provider remains automatically eligible for every new Service.
- Public booking never asks the customer to choose a Provider and always binds the sole eligible Owner-Provider before hold acquisition and confirmation.
- Attempts to inject a Team plan, additional Provider mutation, cross-Merchant Provider, or stale removed route fail through typed, non-disclosing errors rather than falling back to hidden Team behavior.
- Existing Operations authentication, Operator Manager authority, operator invitation/enrollment, Merchant discovery, and impersonation suites remain unchanged and green.
- Repository search finds no live Merchant Team implementation outside clearly marked deferred historical documents or immutable old migrations.
- The parity ledger and generated evidence describe the BeeSolo Solo profile truthfully; removed Team scenarios are not left as launch obligations.

## Verification

Run formatting, typecheck, lint, unit/integration tests, real-D1 migration tests from an empty database and from the latest pre-contraction schema, Merchant and Booking browser tests, the Public Site ingress suite, the parity-ledger structural check, and a focused repository search for `team` plan literals and Team-facing copy. Record any intentionally retained match with its non-Merchant-Team reason.

## Comments

### Resolution

Contracted the launch product to one immutable Solo entitlement and one active default Owner-Provider across D1, Merchant context and onboarding, catalog capabilities, Merchant App, Booking App, fixtures, parity coverage, and verification documentation.

- Added a forward-only D1 contraction migration with explicit operator preconditions. It aborts without modifying rows when a non-Solo Merchant or an incompatible Provider graph exists, then enforces Solo-only plan writes. Real-D1 tests cover compatible upgrade, Team-plan rejection, and additional-Provider rejection with row preservation.
- Removed additional-Provider creation and Team catalog administration. Owner onboarding still atomically creates the Merchant, Owner Membership, Shop, and active default Owner-Provider; new Services atomically grant that Provider eligibility.
- Reduced the Merchant subscription surface to immutable Solo behavior and the Provider surface to the Owner professional profile. Removed Team navigation, plan switching, filters, comparison copy, and Provider-creation mutations.
- Removed public Provider preference and selection behavior. Public Booking binds the sole eligible default Owner-Provider before scheduling; removed Provider routes return non-disclosing not-found responses.
- Removed Team/provider-selection parity states and smoke scenarios, regenerated the parity ledger, and replaced Team-facing expectations with Solo absence and binding assertions.
- Preserved Provider identity, status, eligibility, schedule rules, immutable Appointment Provider snapshots, historical Provider references, Merchant Owner membership authorization, and Operations authority as required by the domain model.

Verification:

- Full workspace typecheck passed across all 25 tasks.
- Focused capabilities suites passed: 7 files, 45 tests.
- Real-D1 Solo entitlement migration suite passed: 3 tests.
- Focused Booking suites passed: 4 files, 32 tests.
- Focused Merchant navigation regression passed: 1 file, 4 tests.
- Parity structural check passed: 155 owned states, 0 unowned, duplicate, or orphan states.
- Targeted formatting, targeted lint, and `git diff --check` passed. Targeted lint retains only existing accessibility warnings in the large Booking flow.
- Full workspace `bun run check` passed: parity, all 25 typecheck tasks, lint, formatting, and all 25 test tasks. The final capabilities suite passed 73 files and 434 tests; the final Merchant suite passed 78 files and 286 tests.

Intentionally retained search matches are limited to immutable historical migrations, clearly deferred or historical product/research documents, migration-test injections that prove rejection, and the lower-level historical unassigned/specific Provider engine behavior required to interpret existing Booking Sessions and Appointment facts. No public route or launch UI exposes that historical preference behavior.
