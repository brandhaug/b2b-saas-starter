# @b2b-saas-starter/failure

The dependency-free leaf every `catch` boundary in the repo shares. Separate entry points own unknown-thrown-value readers (`.`), the shared 503 typed error (`./capability`), failure narrowing (`./narrowing`), sanitized persistence diagnostics (`./persistence`), CSPRNG bytes (`./crypto`), and the outbound provider transport (`./http-client`).

## Contracts

- `errorMessage` returns an `Error`'s message or `undefined` — including for an `Error` whose message is empty, which reads as no message rather than as an empty toast. `failureMessage` is the always-a-string form for diagnostics; it never fills a typed-error `reason`. Callers choose what absence means.
- `orUnavailable(capability)` maps a D1 or query failure onto `CapabilityUnavailable`. SQL failures get `persistence_sql`; schema failures get `persistence_decode`. Any other failure keeps an inner `CapabilityUnavailable`'s reason or becomes `unavailable`; its message never enters the reason. Recognized synchronous codec defects include code-owned column and read/write context. Rejected values, SQL and parameters never enter these reasons. Unrelated defects and interruptions remain intact, including in mixed causes. Apply it to every Live-layer database call.
- A narrowing that replaces a failure with a code-owned, HTTP-safe error (`CapabilityUnavailable`, `ConversationUnavailable`) goes through `narrowFailure`, `attempt`/`attemptPromise` (for `Effect.try`/`tryPromise`) or `orUnavailable`. `tryPromiseOrUnavailable` is `attemptPromise` for a platform binding call that fails as `unavailable`. The new error remembers the replaced failure's `_tag`, or `untagged` for a thrown value, never its message; the logger reads it back (`narrowedCauseTag`) as `causeTag` only when that error is the request's final failure. A re-narrowed error keeps the first tag in its chain, so `SchemaError → CapabilityUnavailable → ConversationUnavailable` still reports `SchemaError`. An error built in a bare `catch` or `mapError` carries no identity. The tag lives in a module-level `WeakMap` keyed by the narrowed error object, so rebuilding, copying or re-decoding that object (`{ ...error }`, Schema encode/decode, an RPC hop) loses it; re-fail the same instance. Reasons stay code-owned literals: the identity goes in `causeTag`, never a message in `reason`.
- `PlatformHttpClientLive` is the one outbound transport provider adapters (Stripe, OpenAI) are composed with. Tests provide `wireHttpClient(respond)`, which also overrides a platform transport composed inside a Live layer; never patch the global fetch.
- `randomHex` is the one CSPRNG call site. Signing secrets, bearer tokens and claim fences are credential material; Effect's `Random` is a seedable PRNG and must never back them.

## Boundaries

- The root entry point stays dependency-free and Effect-free. Typed errors belong in `./capability`.
- This package owns the lint suppressions its probes need (see the single-file override in [`lint.config.ts`](../../lint.config.ts)). Don't re-hand-roll `instanceof Error` with a fresh suppression somewhere else — that is exactly the seven-copy duplication this package replaced.
