# Code style rule review

## Failure and false-positive matrix

Written before implementation. `no-nested-service-yield` reports an inline
delegated yield used as the receiver of a method call inside a recognized Effect
generator. Bind the receiver with `const service = yield* Service` first.

| Fixture                                                              | Expected            |
| -------------------------------------------------------------------- | ------------------- |
| `yield* (yield* Service).method()` in `Effect.gen`                   | Report              |
| `return yield* (yield* Service).method()`                            | Report              |
| Namespaced service reference or computed method                      | Report              |
| Named import alias for Effect; namespace import from `effect/Effect` | Report              |
| Direct and curried `Effect.fn`, `Effect.fnUntraced`                  | Report              |
| Receiver acquired separately                                         | Quiet               |
| Plain native generator, including one nested inside Effect.gen       | Quiet               |
| Unrelated object named Effect                                        | Quiet               |
| Import shadowed by a parameter or block-local binding                | Quiet               |
| Namespace import from `effect` used as if it were Effect             | Quiet               |
| Nondelegated yield receiver                                          | Quiet               |
| Type-only import                                                     | Quiet               |
| Dynamic generator method, local alias of gen, indirect callback      | Quiet, syntax limit |

Additional false-positive fixtures, written before narrowing the implementation:
`.find` on `yield* host.reservations()` and methods on factory call results must
stay quiet. A yielded operation may return a collection rather than a service.
Lowercase value references such as `reservations` and `Clock.currentTimeMillis`
also stay quiet. These fixtures precede the implementation change.

The rule establishes the generator's imported Effect binding through lexical
scope, not the service's type. Only a direct capitalized reference such as `Store`
or `Services.Store` is eligible. Capitalization follows the repo's service class
convention; it cannot prove a reference's type. Lowercase service aliases and
capitalized ordinary effects are respectively false-negative and false-positive
limits. It does not follow re-exports or variable aliases, inspect types, or
rewrite source.

## Pure callbacks

Do not ban `() => Effect.succeed(value)` generally. Service implementations,
`catchTag` recovery and suspended computations can require an Effect result.
Even an expression without calls can read a getter or proxy. A useful future
rule would target a particular combinator, such as `flatMap` to `map`, rather
than claiming to prove arbitrary callback purity. This sweep leaves that judgment
to review.

## Existing-rule probes

The installed `oxlint-plugin-effect@0.29.0` and vendored `anti-slop` plugins were probed
with every exported rule enabled, not just the root presets. The builtin probe
enabled all categories plus nursery for TypeScript, unicorn, oxc, import and
promise. Fixtures included:

```ts
import { Effect } from 'effect'

export const read = Effect.fn('read')(function* () {
  return yield* (yield* Store).read()
})
```

```ts
import { Effect } from 'effect'

export const read = Effect.flatMap(source, (value) => Effect.succeed(value))
```

Neither plugin reports the nested receiver or unnecessary `succeed` wrapper.
The initial single-line probe source produced only anti-slop spacing diagnostics.
Builtins reported unrelated undefined fixture bindings, export/import style and
generator naming; `unicorn/no-array-method-this-argument` misidentified the
data-first `Effect.flatMap` call. No builtin named a service binding replacement.
The redundant-else control fixture did produce `eslint/no-else-return`, already
enabled at root with `allowElseIf: false`. No new else rule is needed.

Probe commands used `vp lint -c <generated-config> --format=json <fixtures>` and
added `-D all -D nursery` for builtins. The configs load the actual installed
Effect plugin and `vendor/anti-slop/plugin.mjs` by absolute path; their rule sets
come from `Object.keys(plugin.rules)`. Preserve that discovery step on upgrades.

## Sweep inventory and exclusions

Examined every source rule, all existing fixture suites, `src/index.ts`,
`src/internal/ast.ts`, `test/harness.ts`, the package manifests and root lint
configuration.

- Moved the six existing rules with preceding helper functions to put their rule
  definition first. Moved the shared AST wrapper predicate below its callers and
  the fixture runner's public operation above subprocess details.
- Kept meaningful syntax predicates, import ownership checks and diagnostic
  collection helpers. Inlined the two single-use schema diagnostic string helpers.
- Moved root configuration helpers below the exported config. Constants remain
  above configuration evaluation because they are read during initialization.
- Kept the three already main-first rules, rule registration, package setup and
  existing fixtures unchanged. Existing fixture assertions still cover all prior
  rule behavior.
- Kept public AST contracts and narrowing predicates explicit. No Effect runtime
  dependency, formatter changes, name-length limits or automatic fixers were added.
- Preserved historical matching behavior in existing rules. For example,
  `no-run-promise-in-tests` accepts a root namespace import in its existing fixture;
  broadening this cleanup into that rule's binding semantics would change policy.
- The new rule resolves lexical imports, including aliases and shadowing. It
  deliberately does not follow local aliases, re-exported Effect modules, root
  namespace member chains or callbacks passed indirectly.

## Validation

- `pnpm -C packages/oxlint-plugin test`: before implementation, the empty rule
  failed all eight positive fixtures while 79 tests passed. The collection
  correction separately failed four valid fixtures before the narrowing change.
  Final result: all 90 tests pass, including the existing 67 fixtures.
- `pnpm -C packages/oxlint-plugin typecheck`: passes.
- `vp lint packages/oxlint-plugin lint.config.ts --format=json`: passes.
- `vp fmt --check packages/oxlint-plugin lint.config.ts`: formatting check.
- An isolated scan enabling only `starter/no-nested-service-yield` over `apps`,
  `packages`, `scripts`, `infra` and `alchemy.run.ts` reports zero violations in
  1,220 files. Earlier broad matching incorrectly reported collection operations;
  that report is superseded by the narrowed rule's scan.

All lint probes and fixtures run through Vite+ 1.4.0's real bundled binary. The
rule has no fixer, and its root enablement relies on import-aware matching rather
than path exclusions. Integration owns the full-repository check.

# Shared UI appearance

`no-ui-appearance-override.test.ts` exercises named/aliased/namespace imports,
shadowing, conditional and template classes, arbitrary variants/properties,
important modifiers, inline appearance styles, and layout/accessibility false
positives through the real oxlint binary. The web override enables the rule;
the shared UI implementation directory is exempt because it owns appearance.

This syntax-only check recognizes appearance utility families, not every possible
Tailwind or custom CSS class. Indirect variables, spread props, variant helper
calls, external CSS, and render-prop styles remain review responsibilities.
Native elements and feature-component imports are outside this rule.

# Operation tracing coverage

`named-effect-operation.test.ts` covers dynamic/empty labels, direct import aliases,
computed members, unrelated APIs, shadowing and justified untraced helpers. It
accepts existing literal labels. `effect/requireNamedEffectFn` is not enabled:
the installed rule misses computed unnamed calls and reports unrelated imports
named Effect. It also ignores dynamic labels and `fnUntraced`. The custom rule
resolves import identity and covers these cases; `effect/preferEffectFn`
continues to own generator-plus-span conversions without duplicate reports. Indirect namespace/function
aliases and operation ownership need review, not syntax inference.
