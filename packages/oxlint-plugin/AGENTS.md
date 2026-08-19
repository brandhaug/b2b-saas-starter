# @b2b-saas-starter/oxlint-plugin

## Purpose & Scope

The repo's own oxlint rules. A convention that only this repo holds belongs here, because a rule fails CI and a paragraph in a markdown file does not. See [ADR 0052](../../docs/adr/0052-repo-local-oxlint-plugin.md) for why this package exists and what was rejected from the two upstream plugins it borrows from.

This is the third and last lint layer. Before reaching for a rule here, check the first two: oxlint's own categories (`correctness`, `suspicious`, `perf` are on), then the third-party JS plugins `oxlint-plugin-effect`, `anti-slop`, and `eslint-plugin-better-tailwindcss`. Most Effect and type-safety discipline is already covered there, and a duplicate rule means two messages for one mistake.

Nothing imports this package at runtime. `.oxlintrc.json` loads `src/index.ts` as a `jsPlugins` entry, and every rule is enabled and scoped from there.

## The rules

| Rule                                 | Catches                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `no-effect-escape-hatch`             | `die`, `dieMessage`, `orDie`, `orDieWith`, which turn a typed failure into an opaque defect      |
| `no-effect-internal-tags`            | `value._tag === 'Some'` and siblings, instead of `Option.isSome` and the other public guards     |
| `no-inline-schema-compile`           | `Schema.decodeUnknownResult(X)(input)` inside a function body, which rebuilds the codec per call |
| `no-interface-merge-outside-dts`     | An `interface` inside a `declare` block in a `.ts` file, which `--fix` silently breaks           |
| `no-mismatched-augmentation-context` | A `.d.ts` whose augmentation kind does not match whether the file is a module                    |
| `no-schema-class`                    | `Schema.Class` and `Schema.TaggedClass`, which encode through `instanceof`                       |
| `no-unknown-error-message`           | `cause.message` and `String(cause)` outside the sanctioned normalizers                           |
| `no-unsupported-effect-api`          | `Effect.async`, `Effect.zipRight`, `Effect.timeoutFail`, renamed in Effect v4                    |
| `prefer-effect-predicate`            | Hand-written `(x) => x !== null` instead of `Predicate.isNotNull`                                |

Three are written for this repo (`no-interface-merge-outside-dts`, `no-mismatched-augmentation-context`, `no-unknown-error-message`). Six are ported from [pingdotgg/t3code](https://github.com/pingdotgg/t3code/tree/main/oxlint-plugin-t3code) or [UsefulSoftwareCo/executor](https://github.com/UsefulSoftwareCo/executor/tree/main/scripts/oxlint-plugin-executor), both MIT, and each file names its source.

## Invariants

1. **Rules are syntax-only.** No rule here touches type information, because oxlint's JS plugin API does not expose the type checker. A check that needs types belongs in a tsgolint rule, not here.
2. **Path gating lives in `.oxlintrc.json`, never in a rule.** Both upstream plugins gate rules on hand-rolled `isTestLike(filename)` and `repoRoot` helpers, which fail open when the layout moves: the rule silently stops reporting and nothing tells you. Exemptions go in an `overrides` block with a comment naming the reason. `context.filename` is fine for reading the file's own extension, which is what the two `.d.ts` rules do.
3. **Every rule has a test file beside it.** Minimum three `valid` cases covering the near-misses and three `invalid` cases, at least one asserting on the message text.
4. **No rule offers a fixer.** `oxlint --fix` runs in the pre-commit hook, so a fixer here would rewrite code on commit with no review. `no-interface-merge-outside-dts` exists precisely because another rule's fixer does that.
5. **`@oxlint/plugins` is the only runtime dependency of `src/`.** The plugin loads inside oxlint's own runtime. `effect` is used by the test harness, not by any rule.
6. **Messages name the replacement.** Every message says what to write instead, with the concrete symbol or file. The upstream messages end in `Skill: wrdn-...` references that do not exist here; those were rewritten.

## The test harness

Oxlint has no in-process rule tester for JS plugins, so `test/harness.ts` drives the real binary. `createRuleHarness('starter/<rule>')` returns `valid` and `invalid` registrars; each writes a fixture into a temp directory, and the first assertion lints all of them in one `oxlint` invocation. One process per rule file, not per case.

```ts
const rule = createRuleHarness('starter/no-schema-class')

describe('starter/no-schema-class', () => {
  rule.valid(
    'allows a struct schema',
    `const User = Schema.Struct({ id: Schema.String })`
  )
  rule.invalid(
    'reports Schema.Class',
    `class User extends Schema.Class<User>('User')({}) {}`,
    (messages) => {
      assert.match(messages, /Schema\.Struct/)
    }
  )
})
```

Pass `{ filename }` when a rule reads the path, which the two `.d.ts` rules do. `--silent` must stay off the oxlint invocation: it suppresses the diagnostics the harness parses.

## Anti-patterns

- Don't add a rule that `effect/*` or `anti-slop/*` already reports. Check the enabled list in `.oxlintrc.json` first, and probe it against a fixture before assuming a gap.
- Don't read the file from disk inside a rule. `context.sourceCode.text` is already there; the upstream `no-ts-nocheck` re-reads every file and pays for it on every pass.
- Don't walk the filesystem at module load. One upstream rule reads every workspace `package.json` before any file is linted.
- Don't encode a policy the repo has settled the other way. `switch` is the example: four enabled rules make it safer here, so a rule banning it would reverse a decision.
- Don't put an exemption list in a rule. See invariant 2.
- Don't read `node.parent` directly when walking upward, and don't believe `no-unnecessary-condition` when it calls the null guard redundant. `@oxlint/plugins` types `parent` as always present and oxlint passes `null` at the `Program` root, so following that advice makes the rule throw on the first file it walks. Use `parentOf` from `internal/ast.ts`. Optional chaining is also safe, which is why the ported rules never hit this.
