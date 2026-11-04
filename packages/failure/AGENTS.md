# @b2b-saas-starter/failure

The dependency-free leaf every `catch` boundary in the repo shares. Separate entry points own unknown-thrown-value readers (`.`), the shared 503 typed error (`./capability`), sanitized persistence diagnostics (`./persistence`), and CSPRNG bytes (`./crypto`).

## Contracts

- `errorMessage` returns an `Error`'s message or `undefined` — including for an `Error` whose message is empty, which reads as no message rather than as an empty toast. `failureMessage` is the always-a-string form for log lines and typed-error `reason` fields. Callers choose what absence means.
- `orUnavailable(capability)` maps a D1 or query failure onto `CapabilityUnavailable`. SQL failures get `persistence_sql`; schema failures get `persistence_decode`. Recognized synchronous codec defects include code-owned column and read/write context. Rejected values, SQL and parameters never enter these reasons. Unrelated defects and interruptions remain intact, including in mixed causes. Apply it to every Live-layer database call.
- `randomHex` is the one CSPRNG call site. Signing secrets, bearer tokens and claim fences are credential material; Effect's `Random` is a seedable PRNG and must never back them.

## Boundaries

- The root entry point stays dependency-free and Effect-free. Typed errors belong in `./capability`.
- This package owns the lint suppressions its probes need (see the single-file override in [`lint.config.ts`](../../lint.config.ts)). Don't re-hand-roll `instanceof Error` with a fresh suppression somewhere else — that is exactly the seven-copy duplication this package replaced.
