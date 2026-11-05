# Code conventions

Read when writing or reviewing source. Scoped intent nodes own domain and runtime
constraints; [Effect examples](effect-examples.md) point to current implementations.

## Reading order and extraction

- Put the main operation first and read it in execution order. Move independent
  helpers below their callers when useful; preserve initialization order.
- Extract for reuse, a meaningful policy decision or a complex boundary. Inline
  trivial single-use expressions; avoid forwarding wrappers and generic helper files.
- Split modules by responsibility or consumers, not line count.

## Names, types and control flow

- Keep local names concise and exported names unambiguous. Preserve domain terms
  and aliases that distinguish collisions.
- Infer locals; declare public success, failure and dependency contracts where useful.
  Derive data types from their owning schemas.
- Prefer `const` and early returns. Name intermediate decisions and repeated work.
  Choose loops, array methods and destructuring for clarity; avoid nested multi-step
  expressions. Backend Effect lint restrictions still apply.

## Effects and boundaries

- Bind services before calling them: `const feed = yield* NotificationFeed`, then
  `yield* feed.markRead(ids)`.
- Keep pure calculations synchronous. Use Effect when failure, dependencies,
  scheduling or resource ownership require it.
- Decode untrusted data at its owning boundary. Recheck authorization, current state
  invariants and data arriving through another external boundary.
- Keep failure, cancellation and concurrency policy visible.

### Execution ownership

Services, repositories and constructors compose Effects. Execute them only at
HTTP/Worker, React lifecycle, CLI or SDK callback boundaries, including framework
conversions such as `HttpRouter.toWebHandler`. Never hide a service behind a Promise
that another service immediately wraps back into Effect.

Compose shared resources once in their application-owned Layer and lifetime.
Browser hooks own their scopes and cancellation locally. Approved runners, managed
runtimes, synchronous crypto and test/setup adapters are listed with reasons in
[`lint.config.ts`](../../lint.config.ts). New exemptions must identify the external
caller and lifetime owner. Effect-native tests use `it.effect` or `it.live`;
native-runner interop requires a justified exception.

### Operation tracing

Use named `Effect.fn('Service.operation')` for reusable service operations and I/O.
Preserve existing labels and span options; new labels are static, code-owned names,
never request data. Do not add a second `withSpan` for the same operation.
Inline programs, callbacks and Layer construction may use `Effect.gen`.

Use `Effect.fnUntraced` for per-event work, tight loops or small helpers already
covered by an operation. Explain the frequency or enclosing boundary in a local
lint suppression.

`Effect.fn` suspends its body. Preserve call-time snapshots, generics, error and
dependency channels, scope and interruption when converting functions. Explicit
generator return types use `Effect.fn.Return<A, E, R>`; whole-operation combinators
follow the body and receive the effect, then the original arguments.

## Comments

Explain non-obvious constraints and failure modes, especially atomicity, isolation,
cancellation, serialization and runtime limits. Remove narration and duplicated
tutorials. Put cross-file invariants in intent nodes and local reasons beside code.

Every lint suppression must explain why the rule is inappropriate, using `-- reason`
or adjacent prose. Stacked directives may share a reason; blank lines and code break
adjacency. A syntactically valid explanation must still justify the exception.

## Browser test synchronization

Wait for observable readiness with locators, responses or events. Do not add fixed
delays or inflate deadlines/retries to hide flakes. Existing runner deadlines and
operation/assertion timeouts remain valid. Diagnose first-attempt evidence and keep
focused/skipped-test bans enabled. Follow the [testing policy](../../AGENTS.md#testing)
and preserve meaningful existing assertions during cleanup.

## Enforcement and review

[`lint.config.ts`](../../lint.config.ts) owns enabled rules and exemptions;
[`vite.config.ts`](../../vite.config.ts) owns formatting. Prefer existing rules;
custom checks follow the [plugin guidance](../../packages/oxlint-plugin/AGENTS.md).

Syntax checks cannot prove ownership, meaningful extraction or deterministic waits.
Review indirect aliases, wrappers and dynamic access too. See the
[style-rule limits](../../packages/oxlint-plugin/test/style-rule-matrix.md) and
[suppression/browser fixtures](../../packages/oxlint-plugin/test/conventions-failure-matrix.md).
Do not impose blanket bans on loops, aliases, destructuring or `else`, or arbitrary
name-length and file-size limits.
