# Convention enforcement failure cases

Written before implementation. Run fixtures through the real Vite+/oxlint binary.

- Reject missing, empty and token-only lint reasons on file, line, next-line and JSX directives, both oxlint and ESLint spelling.
- Accept inline reasons and adjacent prose before or after a directive, stacked directives and multiline comments. Blank lines and code break adjacency. Enable directives and TypeScript comments remain outside this rule.
- Preserve unused-disable and TypeScript-description checks.
- Browser checks reject waitForTimeout calls, including literal computed properties and receiver aliases. Event waits and operation timeouts pass.
- Reject imported Playwright test.setTimeout, test.slow and test.describe.configure timeout/retries, including import aliases, namespace imports and literal computed properties.
- Accept unrelated objects, shadowed imports, configuration outside E2E, mode-only describe configuration and operation timeouts.
- Dynamic keys, assignment aliases, spread configuration and wrapper functions remain review limitations. No fixers.
