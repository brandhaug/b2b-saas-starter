# Explicit state machine transitions

Every stored status machine in this repository — checkout claims, provider
events, synchronization, email deliveries, webhook deliveries, investigation
tasks, API tokens, invitations, suspension, exports, assistant reservations,
conversation tombstones — is made explicit through one owner module per
machine. The module declares the states (imported from
`@b2b-saas-starter/db` enums, never restated), the legal transition set as an
exhaustive `satisfies` map (or one named decision function where a transition
depends on richer evidence than an event, as billing access does), and the
named predicate sets (`open`, `terminal`, `replayable`, `settled`) that
surround it. Seed and Live adapters route status writes through the module and
compose SQL filters from its exported sets instead of inline literals. Where
SQL mirrors a predicate set — a partial index, a trigger guard, a retention
`CASE` — the owner module's doc comment names that SQL by table and migration,
so a vocabulary change surfaces every mirror that must follow. Contract tests
pin the legal transitions and refuse the illegal ones for both adapters.
Applied migration files are never edited to match; their SQL is named, not
rewritten.

## Why not a state machine library

XState v5 and `@xstate/store` were evaluated against every machine in the
inventory and declined for all three classes of machine this repository has.

**Durable D1-row machines.** The state of a checkout claim or an email
delivery lives in a row that concurrent Worker isolates transition through
guarded conditional SQL — fencing leases, partial unique indexes, ranked
merges. That SQL is the concurrency authority: it settles write-write races
an actor cannot even observe. A statechart actor here would be rehydrated
from the row on every request, transition in memory, and still need the same
guarded write to commit — decoration over the guard, with a second
description of the machine that can drift from it. The owner module keeps
one description and lets SQL keep the authority.

**In-process orchestration.** Lease acquisition retries, synchronization
workflows, and SSE observation are already Effect fibers with schedules,
supervision, and interruption. An actor runtime beside Effect would duplicate
supervision and interruption semantics for no new capability. Effect stays
the orchestrator.

**Client UI machines.** The finite-mode UI flows (assistant connection,
two-factor setup, clipboard) are two- to four-state pure reducers. Their
async is owned elsewhere — partysocket owns reconnection timing, Effect
scopes own socket lifetimes, TanStack Query owns server state — so a machine
would own nothing but the four labels. That is below the threshold where a
machine library pays for itself, and adding one to the client graph costs a
runtime dependency against the client-boundary discipline. The reducers stay
hand-rolled, pure, and directly unit-tested, including their fenced and
terminal events.

A future machine that is genuinely actor-shaped — a multi-step human workflow
in the UI, compound async with cancellation the machine itself must own —
should revisit this decision against these criteria rather than treat it as a
ban.
