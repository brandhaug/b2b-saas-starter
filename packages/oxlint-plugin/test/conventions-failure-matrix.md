# Convention enforcement failure cases

Written before implementation. Run fixtures through the real Vite+/oxlint binary.

- Reject missing, empty and token-only lint reasons on file, line, next-line and JSX directives, both oxlint and ESLint spelling.
- Accept inline reasons and adjacent prose before or after a directive, stacked directives and multiline comments. Blank lines and code break adjacency. Enable directives and TypeScript comments remain outside this rule.
- Preserve unused-disable and TypeScript-description checks.
- Browser checks reject waitForTimeout calls, including literal computed properties and receiver aliases. Event waits and operation timeouts pass.
- Reject imported Playwright test.setTimeout, test.slow and test.describe.configure timeout/retries, including import aliases, namespace imports and literal computed properties.
- Accept unrelated objects, shadowed imports, configuration outside E2E, mode-only describe configuration and operation timeouts.
- Dynamic keys, assignment aliases, spread configuration and wrapper functions remain review limitations. No fixers.

## Test synchronization

Written before implementation. Adapted from the MIT-licensed `@interfere/landmines`
rules of the same names (licence in [`third-party-licenses.md`](../third-party-licenses.md)), without their per-file allowlists: exceptions use a reasoned
suppression or a root `overrides` block like every other starter rule.

- `no-fixed-sleep` rejects an awaited fixed delay directly inside a `test`, `it` or lifecycle-hook callback, including `.each`/`.effect` chains: `new Promise` whose executor only schedules `resolve` through `setTimeout`, `globalThis.setTimeout` or `window.setTimeout`; `setTimeout` imported (or aliased) from `node:timers/promises`; and `scheduler.wait`.
- It accepts the same code in a file that calls `vi.useFakeTimers()`, a timer that is scheduled but not awaited, an awaited event or operation, and sleeps outside test bodies.
- `no-unsignaled-poll` rejects `vi.waitFor` and `expect.poll` callbacks whose single expression reads a recorder (a `.mock` path, or `.length`/`.size` on a member) or, for `vi.waitFor`, asserts a spy matcher or `toHaveLength` on a plain reference, and `expect.poll(() => recorder).toHaveLength(n)`.
- It accepts polls on DOM queries made through calls (`screen.getByRole(...)`), React `.current` refs, non-recorder state other than a member's `.length`/`.size`, and multi-statement callbacks. The `.length`/`.size` heuristic also matches plain collections (`cache.size`); those take a reasoned suppression.
- `no-test-retry` rejects a non-zero `retry` in test, `it`, `describe` or `suite` options (any argument position, including `.each(...)(...)`, `.effect`/`.live` and `layer(...)` callback testers), in `vi.setConfig`, in any Vitest `test: { ... }` configuration block, and a non-zero top-level `retries` in Playwright's `defineConfig`.
- It accepts `retry: 0`, timeouts, `Effect.retry` and `retry` keys passed to non-test calls.
- Review limitations: `Bun.sleep` (no Bun runtime here), sleeps inside helpers or nested functions called from a test, `Effect.sleep` under `it.live`, Testing Library's `waitFor`, dynamic keys, spread options, the Vitest `--retry` CLI flag and per-project Playwright `retries`. No fixers.
