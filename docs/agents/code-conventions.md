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
