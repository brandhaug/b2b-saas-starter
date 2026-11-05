# Code conventions

Read when writing or reviewing source. Scoped intent nodes own domain and runtime
constraints; these conventions guide readability within those constraints.

## Reading order and extraction

- Make the main operation easy to find and read in execution order. Put independent
  function helpers below the export they support when that improves navigation.
  Preserve initialization order for constants, registrations and side effects.
- Extract a helper when it has real reuse, names a meaningful policy decision or
  hides a complex boundary. Keep trivial single-use expressions inline. A helper's
  name should explain more than its implementation syntax.
- Keep related operations together. Split a module when consumers or responsibilities
  differ, not when it reaches an arbitrary line count. Avoid generic helper files
  and forwarding wrappers that only add another call to follow.

## Names, types and control flow

- Use concise local names where context supplies the domain, such as `feed` for a
  bound `NotificationFeed`. Keep exported names unambiguous. Preserve domain terms
  and import aliases that distinguish genuine collisions.
- Infer local types. Declare public contracts when they communicate success values,
  typed failures or dependencies. Derive types from the owning schema instead of
  repeating its fields.
- Prefer `const` and early returns. Keep a local variable when its name explains a
  decision, identifies an intermediate result or avoids repeated work.
- Choose loops, array methods and destructuring for clarity. Do not compress
  multi-step logic into nested expressions merely to reduce lines or variables.
  Backend Effect lint restrictions still apply.

## Effects and boundaries

- Bind a yielded service before invoking its methods. Avoid nested service yields
  such as `yield* (yield* NotificationFeed).markRead(ids)`.
- Keep pure calculations synchronous. Use Effect for work that needs its failure,
  dependency, scheduling or resource semantics; do not wrap ordinary option building
  or projections solely for stylistic uniformity.
- Decode untrusted values at the boundary that owns them and pass typed values
  inward. Current authorization, state invariants and data from another external
  boundary still require their own checks.
- Keep failure and cancellation policy visible. Follow the owning service's
  lifetime and concurrency rules rather than replacing them with generic recovery.
  See [Effect examples](effect-examples.md) and the relevant package intent node.

### Execution ownership

Services, repositories and their constructors return or compose Effects. Do not
call `Effect.runPromise*`, `runSync*`, `runFork*`, `runCallback*`, runtime runner
methods or `ManagedRuntime.make` there. `yield*`, `Effect.forkScoped` and Stream
operations returning Effects compose work; they do not cross this boundary.

Execution belongs in named React lifecycle callbacks, HTTP/Worker adapters,
CLI entrypoints and SDK callback adapters. Framework conversions such as
`HttpRouter.toWebHandler` belong at the same boundary. An imperative adapter must
not hide an Effect service behind a Promise that another service immediately
wraps back into Effect. Return the Effect directly in that case.

Compose a shared resource once in its application-owned Layer and lifetime.
Consumers use that environment rather than creating feature-specific runtimes.
The web request logger, Better Auth integration, background invocation runtime
and per-Durable-Object conversation host have distinct owners and lifetimes.
Browser hooks own their scopes, cancellation and cleanup; keep those scopes local
to the React lifecycle rather than moving them into server runtimes.

`lint.config.ts` names approved execution files with reasons. The assistant
Cloudflare binding and scoped Seed host implement imperative host ports; the
synchronous crypto adapters preserve the credential/ID platform API. Test and
setup adapters can execute at runner boundaries, but Effect-native tests still
use `it.effect`/`it.live`; `starter/no-run-promise-in-tests` retains its separate
interop policy. A new exemption must identify the external caller and lifetime
owner, not merely name the file `runtime.ts` or `adapter.ts`.

`effect/noRunPromise` enforces Promise edges and
`starter/no-runtime-execution` covers the other imported execution APIs and
managed construction. These syntax checks cannot prove resource sharing or
follow arbitrary aliases/re-exports; ownership and indirect execution still
require review. The rule fixtures document the matching limits.

### Operation tracing

Use named `Effect.fn('Service.operation')` for reusable service operations and I/O.
Keep established service names and existing span labels/options. New labels are
static, code-owned names, never IDs, URLs or request data. Named `Effect.fn` adds
one span through the existing tracer; do not add a second `withSpan` for that same
operation. Inline programs, callbacks and layer construction can use `Effect.gen`.
Pure helpers stay synchronous.

Use `Effect.fnUntraced` deliberately for per-chunk/per-event work, tight loops or
small helpers already covered by an operation boundary. Add a local lint suppression
with the specific frequency or enclosing boundary that makes tracing redundant.
Do not convert every small helper into a traced operation just to satisfy lint.

When replacing a function wrapping `Effect.gen`, preserve call-time work versus
execution-time work, generics, error/dependency channels, resource scope and
interruption. `Effect.fn` suspends both generator and ordinary callback bodies.
Keep any deliberate call-time snapshots outside that body. Explicit generator
return types use `Effect.fn.Return<A, E, R>`. Put whole-operation combinators after
the body; transforms receive the effect followed by the original arguments.

## Comments

Explain non-obvious constraints, failure modes and surprising behavior. Preserve
comments about atomicity, tenant isolation, cancellation, serialization and runtime
limitations. Remove narration of obvious statements and repeated tutorials already
owned by shared guidance. Put cross-file invariants in the relevant intent node;
keep implementation-specific reasons next to the code.

Every lint suppression needs an explanation of the constraint that makes the rule
inappropriate. Put `-- reason` on the directive or prose immediately before or after
it. Adjacent stacked directives may share an explanation; blank lines and code
break adjacency. `starter/require-suppression-reason` requires at least ten characters
and two words. Review must still judge whether the reason actually explains the
exception. TypeScript descriptions and unused-suppression checks remain enabled.

## Browser test synchronization

Wait for observable readiness with Playwright locators, responses or events. Do not
add fixed delays or inflate test deadlines/retries to make a flaky test pass.
In `apps/web/e2e/**`, the bundled `no-restricted-properties` rule rejects
`waitForTimeout`, including literal computed access and receiver aliases.
`starter/no-browser-test-inflation` rejects imported Playwright `test.setTimeout`,
`test.slow` and inline `test.describe.configure` timeout/retry overrides. Import
aliases and namespace imports are checked; shadowed identifiers are not.
Existing runner deadlines and operation/assertion timeouts remain valid.

These are selective syntax checks. Dynamic keys, assignment aliases, test fixtures
re-exported from other modules, callback `testInfo` objects, spread options and timer wrappers still
need review. They do not prove deterministic synchronization. Keep focused/skipped
test bans enabled and diagnose failures from their first-attempt evidence.

## Enforcement and review

[`lint.config.ts`](../../lint.config.ts) owns enabled rules and path exemptions;
[`vite.config.ts`](../../vite.config.ts) owns formatting. Use existing lint rules
before adding a custom rule. Follow the [plugin guidance](../../packages/oxlint-plugin/AGENTS.md)
for syntax-only checks, failure and false-positive fixtures, and concrete diagnostics.
Custom rules have no automatic fixers.

`effect/preferEffectFn` checks generators that add spans.
`starter/named-effect-operation` checks unnamed callbacks, static labels and explicit
`fnUntraced` exceptions in `apps/**` and `packages/**`, not deployment/build
orchestration. It resolves direct
Effect imports and shadowing; indirect aliases and deciding which arbitrary
functions are reusable effectful operations remain review judgments. Existing
nonempty literal labels are accepted to preserve trace identity.

`starter/no-nested-service-yield` checks direct capitalized service references inside
imported Effect generator callbacks. It resolves the Effect import and its shadowing;
capitalization is a syntax heuristic, not proof of the service's type. Indirect
callbacks and lowercase service aliases remain review judgments. See the
[rule fixtures and limitations](../../packages/oxlint-plugin/test/style-rule-matrix.md).

Reading order, meaningful names and extraction remain review judgments. Do not
enforce blanket bans on loops, aliases, destructuring or `else`, or impose name-length
and file-size limits. The [root testing policy](../../AGENTS.md#testing) governs
verification; a cleanup must preserve meaningful existing assertions.
