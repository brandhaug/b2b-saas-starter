# Local oxlint plugin

`automation/` is a JS plugin for oxlint, loaded from the root `.oxlintrc.json`:

```json
"jsPlugins": [{ "name": "automation", "specifier": "./tools/oxlint/automation/index.ts" }]
```

The rules are ported from [`typeonce-dev/ai-automation`](https://github.com/typeonce-dev/ai-automation)
(`rules/oxlint`, profile `effect`), adapted to oxlint's plain ESLint-style plugin
shape: `{ meta, create(context) }`, ESTree visitor keys, and
`context.report({ node, message })`.

`oxlint --fix` runs in the pre-commit hook through lint-staged, so a false
positive blocks every commit. Both rules stay silent unless they can prove the
error is discarded, and both accept an explicit opt-out.

## Rules

### `automation/no-silent-error-swallow`

An error must reach the Effect error channel, a tagged error, or the logger.
This repo routes failures through Effect typed errors and reports them on the
request's wide event (see `ARCHITECTURE.md`); a discarded error is invisible in
production.

Reports:

- an empty `catch` block;
- a `catch` whose binding is absent or never read, unless the body rethrows,
  logs, constructs a `*Error`/`*Exception`/`*Failure`/`*Defect`, or calls
  `Effect.fail` / `Effect.die`;
- a handler passed to `catch`, `catchAll`, `catchAllCause`, `catchAllDefect`,
  `catchCause`, `catchIf`, `catchReason`, `catchReasons`, `catchSome`,
  `catchTag`, or `catchTags` that takes no parameter, never reads its parameter,
  or collapses to `Effect.void` / `Effect.unit` — including handlers nested in
  the object form, `Effect.catchTags({ Boom: () => Effect.void })`.

Accepted:

- any `catch` or handler that reads the error (logging it, rethrowing it,
  wrapping it in a tagged error, or feeding it to an Effect combinator);
- a `catch`/handler binding prefixed with `_`, which marks the discard as
  deliberate — the same convention as unused-variable rules.

Upstream only reported `Effect.catch*` handlers that collapse to `Effect.void`
or `Effect.unit`; it leaves plain `try`/`catch` to its separate `no-try-catch`
rule, which this repo does not want. The `catch`-clause and unread-binding cases
here are additions.

### `automation/no-direct-fetch`

Outbound HTTP belongs behind an Effect platform client, so requests inherit
retries, tracing, and typed failures instead of raw `Response` handling.

Reports `fetch(...)`, `globalThis.fetch(...)`, `window.fetch(...)`,
`self.fetch(...)`, and `global.fetch(...)`.

Accepted: a local variable, parameter, or import named `fetch` (resolved through
oxlint's scope chain, so an injected fetcher is never flagged), a method call on
a non-global receiver such as `client.fetch(...)`, and type positions like
`typeof globalThis.fetch`.

Upstream's guidance for a package that legitimately owns HTTP is a file
override; in this repo the narrower escape hatch is a comment at the call site:

```ts
// oxlint-disable-next-line automation/no-direct-fetch -- named platform adapter
fetch(url, { method: 'POST', headers, body })
```

## Tests

```bash
bunx vitest run --dir tools/oxlint
```

`tools/` is not a workspace package, so `bun run test` (turbo) does not pick
these up; run the command above after changing a rule.

The oxlint binary is the plugin's only real harness, so the tests drive it end
to end: a throwaway config in the temp directory loads the plugin with every
other rule off, oxlint lints a fixture, and the `--format=json` output is
compared with the `/* expect: <rule-name> */` markers in the fixture. Markers
travel with the code they annotate, so reformatting cannot invalidate them — put
each marker on the line where the reported node starts, and keep the line short
enough that `oxfmt` will not split it. Two further tests check that the root config really loads the plugin, and that
`fixtures/` stays out of the repository-wide run.

`fixtures/` holds deliberate violations, so it carries its own nested
`.oxlintrc.json` that turns everything off for that directory. Without it the
repo-wide lint (and the pre-commit hook) would fail on the fixtures.

## Adding a third rule

1. Write the rule in `automation/index.ts` as `{ meta, create(context) }` and
   register it under `rules` in the default export. Keep the plugin's `meta.name`
   as `automation`.
2. Add `fixtures/<rule-name>.invalid.ts` with a `/* expect: <rule-name> */`
   marker on every line that must report, and `fixtures/<rule-name>.valid.ts`
   with the patterns that must stay silent — one entry per precision claim you
   want to hold.
3. Add the rule name to `ruleNames` in `automation/index.test.ts`; the existing
   cases then cover it.
4. Enable it in the root `.oxlintrc.json` under `rules` as
   `"automation/<rule-name>": "error"`.
5. Run `bunx vitest run --dir tools/oxlint`, then
   `bunx oxlint --type-aware` to see the repo-wide hit count before enabling it
   in CI.

Useful `context.sourceCode` helpers when writing a rule: `getScope`,
`getDeclaredVariables` (to tell used bindings from unused ones),
`isGlobalReference` (only true for names declared in `env`/`globals`), and
`visitorKeys` (to walk a subtree without following `parent` links).
