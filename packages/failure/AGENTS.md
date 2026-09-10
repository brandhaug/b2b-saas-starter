# @b2b-saas-starter/failure

The dependency-free leaf every `catch` boundary in the repo shares. Three entry points, deliberately separate: `.` (unknown-thrown-value readers), `./capability` (the shared 503 typed error), `./crypto` (CSPRNG bytes).

## Contracts

- `errorMessage` returns an `Error`'s message or `undefined` — including for an `Error` whose message is empty, which reads as no message rather than as an empty toast. `failureMessage` is the always-a-string form for log lines and typed-error `reason` fields. Callers choose what absence means.
- `orUnavailable(capability)` maps a D1 or query failure onto `CapabilityUnavailable`, so infrastructure failures reach callers in the error channel instead of as defects. Apply it to every Live-layer database call.
- `randomHex` is the one CSPRNG call site. Signing secrets, bearer tokens and claim fences are credential material; Effect's `Random` is a seedable PRNG and must never back them.

## Boundaries

- The root entry point stays dependency-free and Effect-free. Typed errors belong in `./capability`.
- This package owns the lint suppressions its probes need (see the single-file override in [`lint.config.ts`](../../lint.config.ts)). Don't re-hand-roll `instanceof Error` with a fresh suppression somewhere else — that is exactly the seven-copy duplication this package replaced.
