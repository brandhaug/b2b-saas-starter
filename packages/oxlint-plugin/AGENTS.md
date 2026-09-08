# @b2b-saas-starter/oxlint-plugin

The repo's own oxlint rules (ADR 0052): a convention only this repo holds belongs here, since a rule fails CI and a paragraph does not.

It is the third and last lint layer: check oxlint's own categories and the `oxlint-plugin-effect`, `anti-slop`, and Tailwind plugins first, as duplicates mean two messages per mistake.

## Contracts

Nothing imports it at runtime; the root [`lint.config.ts`](../../lint.config.ts) loads it as a `lint.jsPlugins` entry and owns enablement, severity, and path overrides (`no-dark-prefix` and `no-hex-color` are scoped to `apps/web/**`, `__root.tsx` exempted). Read it before changing a rule's reach.

## Invariants

1. **Rules are syntax-only**: the JS plugin API exposes no type checker, so a check needing types belongs in a tsgolint rule.
2. **Path gating and exemptions live in the root config, never in a rule.** Hand-rolled gating fails open when the layout moves and the rule stops reporting silently. Exemptions belong in an `overrides` block with a reason; reading `context.filename` for the file's extension is fine.
3. **Every rule has a test file beside it**: three `valid` near-misses, three `invalid`, one asserting text.
4. **No rule offers a fixer**: `check:fix` runs `vp lint --fix`, so one would rewrite code unreviewed.
5. **Messages name the replacement**: a concrete symbol or file.

## Changes

`test/harness.ts` shells out to the real binary, JS plugins having no in-process tester: `createRuleHarness('starter/<rule>')` writes fixtures to a temp directory and the first assertion lints them all at once. Pass `{ filename }` when a rule reads the path, and keep `--silent` off: it suppresses the diagnostics the harness parses.

## Boundaries

- Don't add a rule `effect/*` or `anti-slop/*` reports; probe a fixture.
- Don't read the file from disk inside a rule (`context.sourceCode.text` is there) or walk the filesystem at load.
- Don't read `node.parent` when walking upward, and don't believe `no-unnecessary-condition` calling that null guard redundant: `@oxlint/plugins` types `parent` as always present while oxlint passes `null` at `Program`, so the rule throws on file one. Use `parentOf` or `isCalleeOfEnclosingCall`.
- Don't re-hand-roll the `Schema.X` walk: `schemaMemberAccess` leaves the rule its property-name check.
