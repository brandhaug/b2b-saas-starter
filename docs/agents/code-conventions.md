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

## Comments

Explain non-obvious constraints, failure modes and surprising behavior. Preserve
comments about atomicity, tenant isolation, cancellation, serialization and runtime
limitations. Remove narration of obvious statements and repeated tutorials already
owned by shared guidance. Put cross-file invariants in the relevant intent node;
keep implementation-specific reasons next to the code.

## Enforcement and review

[`lint.config.ts`](../../lint.config.ts) owns enabled rules and path exemptions;
[`vite.config.ts`](../../vite.config.ts) owns formatting. Use existing lint rules
before adding a custom rule. Follow the [plugin guidance](../../packages/oxlint-plugin/AGENTS.md)
for syntax-only checks, failure and false-positive fixtures, and concrete diagnostics.
Custom rules have no automatic fixers.

`starter/no-nested-service-yield` checks direct capitalized service references inside
imported Effect generator callbacks. It resolves the Effect import and its shadowing;
capitalization is a syntax heuristic, not proof of the service's type. Indirect
callbacks and lowercase service aliases remain review judgments. See the
[rule fixtures and limitations](../../packages/oxlint-plugin/test/style-rule-matrix.md).

Reading order, meaningful names and extraction remain review judgments. Do not
enforce blanket bans on loops, aliases, destructuring or `else`, or impose name-length
and file-size limits. The [root testing policy](../../AGENTS.md#testing) governs
verification; a cleanup must preserve meaningful existing assertions.
