# Booking Product Verification

The verification contract follows the five production boundaries and uses only
Bun commands.

## Canonical scenario

`buildSeedBookingScenario(anchorTime)` is the sole authored booking graph. Its
explicit ISO clock anchor makes identifiers, Appointments, Confirmation expiry,
and schedule facts repeatable. `scripts/seed.ts` projects that graph into local
D1; Seed capability adapters derive from it; tests and screenshot setup must call
the same builder rather than authoring parallel Merchant graphs.

The seed command deletes and replaces only `mer_seed_booking_studio`. It is safe
to rerun against the persisted Wrangler v3 state used by all local Workers.

## Quality gate

```bash
bun run build
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run test:e2e
```

`bun run test` includes unit and integration suites plus isolated real-workerd D1
tests. D1 provisioning applies every committed migration from an empty database.
The migration contract also verifies the final pre-contract schema upgrades to
the contracted Booking Product tables. Playwright enters through the Public Site;
it must not use the Booking App's development-only direct origin.

Operations Worker and hydrated TanStack runtime tests use isolated, migrated D1
state. They must not import the development Worker shim or attach
`packages/db/.wrangler/state/v3`; authentication inside validation must never
replace a developer's active Operator Session.

## Coverage map

| Contract                                             | Primary automated evidence                                    |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| verified Owner auth, host-only cookie, origin checks | `apps/merchant/src/lib/merchant-auth.integration.test.ts`     |
| catalog, eligibility, schedule, publication          | Merchant handlers and capability Live tests                   |
| Specific/Any Provider, Hold, fixed Quote             | Booking selection/scheduling Live tests                       |
| Pay In Person, idempotent atomic confirmation        | checkout and confirmation Live tests                          |
| Merchant Appointment/Customer views                  | appointment operations tests                                  |
| secure Confirmation and secret non-persistence       | booking HTTP and confirmation Live tests                      |
| scoped Platform API and non-disclosure               | API and developer-platform Live tests                         |
| PII-free durable events, retry/recovery              | notification Live and Background Worker tests                 |
| Public Site ingress and route ownership              | dispatch tests and Playwright                                 |
| isolated Operations auth and hydrated runtime        | Operations Worker integration and browser runtime tests       |
| clean/upgrade D1 and persisted local startup         | `packages/db/src/live-d1.test.ts` and local-development tests |

Provider outages are deliberately tested without live third parties. Confirmation
must return its committed result if queue publication fails. Email and each
Webhook delivery are recorded independently; failed outbox work remains claimable
by a later queue invocation or scheduled sweep without creating another
Appointment.

## Booking parity harness

`bun --cwd apps/booking parity:smoke` is the named-scenario browser seam for
Booking parity work. It enters through the Public Site on port 3071, blocks
undeclared origins, installs the scenario clock and timezone, and captures the
DOM, accessibility tree, console, requests, HAR, trace, video, screenshots,
canonical state, and mutation history. Every initial smoke scenario runs twice;
the command fails when semantic assertions fail or screenshot/canonical-state
hashes differ.

Generated evidence is local-only under `apps/booking/parity-evidence/`. Fixture
and scenario contracts are checked independently by the Booking unit suite.
