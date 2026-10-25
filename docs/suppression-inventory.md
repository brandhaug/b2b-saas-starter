# Suppression inventory

Generate the [source-linked report](generated/suppressions.md) with
`pnpm run suppressions:generate`; verify freshness with `pnpm run suppressions:check`.
The check compares the complete report, not a count budget. Review additions by
source, rule and scope. Regenerating accepts changes; it does not approve them.

## Coverage and interpretation

The generator uses Oxc's parsed comments in Git-tracked and non-ignored untracked
JavaScript and TypeScript files, including JSX and handwritten `.d.ts` files.
It fails on parse errors rather than publishing a partial inventory. Generated
route trees, i18n output, dependency/build/runtime directories, `vendor`, agent
skills and `.context` are excluded explicitly in the generator. Markdown examples,
patches and strings containing fixture source are not active source directives.
Root [lint configuration](../lint.config.ts) exemptions remain in their owning
configuration; this report inventories source comments, not disabled config rules.

Recognized directives are `oxlint-disable`, `eslint-disable`, their `-line` and
`-next-line` forms, and matching `enable` controls; `@ts-expect-error`, `@ts-ignore`,
`@ts-nocheck`; and `@effect-diagnostics` / `@effect-diagnostics-next-line` settings
whose severity is `off`. There are currently no Effect diagnostic directives in
repo-owned source. The [compiler setup](setup.md#type-checking) explains why these
diagnostics are not an active compiler gate.

Scopes describe directive syntax. A lint `disable` changes the selected rules
from its location, potentially through EOF. Matching `enable` comments are listed
as restore controls so partial rule restores remain visible. The report does not
compute effective diagnostic ranges or claim every listed directive suppresses a
currently enabled rule. Whole-file TypeScript and Effect settings are labeled
separately from next-line directives.

Explanations include text after `--`, or after a TypeScript directive, plus
contiguous non-directive comments immediately before and after the directive.
Only whitespace with at most one newline may separate those comments; code,
a blank line, or another directive ends association. Multiline comment stars
are stripped and lines joined. A missing associated explanation means only that
this rule found none. Distant module documentation and references such as
"see SAFETY above" still require following the source link.

Classification is a review aid, not approval. `@ts-expect-error` in test paths is
a negative type test. TODO, FIXME, workaround or "temporary suppression/exception/
fix/hack/debt" wording marks temporary debt. Boundary-related wording marks a boundary explanation, including
legitimate framework and provider interop. Other entries are explained exceptions
or unclassified. These lexical labels do not prove safety, test validity or that
an exception can be removed. The two negative audit-log tests exercise malformed
input deliberately rather than bypassing application validation.

## Enforcement limits

Repo-owned JS lint rules inspect syntax without a type checker. They cannot prove
whole-program behavior, authorization, runtime resource ownership, or every alias
and dynamic import. Rule reach and path exemptions belong to `lint.config.ts`.
See the existing accepted/rejected fixtures for
[Effect execution in tests](../packages/oxlint-plugin/src/rules/no-run-promise-in-tests.test.ts),
[schema compilation](../packages/oxlint-plugin/src/rules/no-inline-schema-compile.test.ts)
and [declaration merges](../packages/oxlint-plugin/src/rules/no-interface-merge-outside-dts.test.ts),
run through the [real-binary harness](../packages/oxlint-plugin/test/harness.ts).
The [plugin guidance](../packages/oxlint-plugin/AGENTS.md) owns rule implementation
policy. The inventory adds freshness enforcement, not a no-growth policy or a
blanket ban on Promises or explanatory comments.

## Verification cases

Before implementing the generator, the failure cases are:

- Strings, templates, regular expressions and JSX text mistaken for comments.
- Narrow directives reported as file-wide, or multiline directives losing rules
  or their explanation.
- Adjacent explanations lost, or explanations borrowed across code or blank lines.
- TypeScript negative tests treated as unexplained debt.
- Effect severity settings other than `off` counted as suppressions.
- Generated or vendored code leaking into the report; handwritten declarations lost.
- Nondeterministic ordering, broken source links, or stale output passing the check.

Run `vp test run scripts/suppression-inventory.test.ts` for isolated parser and
command-line regression fixtures. These tooling checks need no application server.
