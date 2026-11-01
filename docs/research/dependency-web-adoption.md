# Web and email dependency adoption

Implemented against installed packages on 2026-11-01. This is the web/email slice of [the adoption plan](dependency-adoption-plan.md).

Final browser confirmation after the hydration and routing corrections: **84 passed, 11 skipped**, with two workers across Chromium, Firefox and WebKit. The previously failing WebKit strong-authentication case passed with its browser-error assertion enabled.

## Required adoptions

### Playwright Credentials

`apps/web/e2e/authentication.ts` now uses `BrowserContext.credentials.install/create/get/delete`. Registration still runs through the application and Better Auth still verifies the signatures. The public sign-in, enrollment and verification helpers keep their parameters. Cleanup handles now expose `remove()` instead of a Chromium CDP session. The three callers were migrated with them.

Each parallel worker retains its own private key and counter file, with mode `0600`. A route handler saves the updated counter before the assertion reaches `/api/auth/passkey/verify-authentication`, so a later failed navigation cannot roll the saved counter back. Ordinary owner fixtures still reuse cookies only; they do not copy credentials into every test context.

The route handler uses `fallback()` after persistence. `continue()` bypassed the session test's earlier route that attaches `cf-connecting-ip`, collapsing simulated devices into the same rate-limit identity. An assertion added to the existing account-session E2E failed with an absent header before this correction. Worker indices identify independent counter files within a project; the browser-project dependency chain prevents overlapping consumers of the same index between browsers. No counter reset, project-global mutable registry or lock was added.

Verified the installed `playwright-core@1.64.1` types and implementation in `lib/coreBundle.js`:

- Imported keys are resident. Registered keys are resident when the request asks for `preferred` or `required` residency.
- Registration flags are UP, UV and AT; assertion flags are UP and UV. Platform attachment and `internal` transport remain available.
- Credentials has no assertion event or uninstall API. Deleting a key removes it from selection while interception remains installed until context disposal.
- The old CDP fixture set backup eligibility/state. Credentials does not expose those options and emits neither backup flag. These tests now exercise a single-device passkey. They do not claim synced-key metadata coverage.
- Virtual conditional requests resolve immediately. The helper disables conditional mediation for explicit ceremonies on subsequent documents, regardless of init-script order. Without that policy, WebKit raced automatic sign-in against the test's explicit sign-in.

Firefox and WebKit projects cover passkey lifecycle, strong authentication, recovery request ownership and toast announcements. They run after Chromium and each other because these projects share the demo account and disposable passkey names. Selecting a dependent browser also runs its prerequisite browser projects; Playwright does not apply the positional file filter to dependencies.

### Localized toast labels

The root document passes `shell_toast_notifications` and `shell_toast_close` from the English and Bokmål catalogs. The vendored `Toaster` remains locale-agnostic and merges caller toast options with its existing `cn-toast` class.

Installed Sonner 2.0.8 builds the region name from `containerAriaLabel` and its hotkey. Using that prop preserves `alt+T`; supplying `customAriaLabel` would replace the whole name. The E2E checks verify `Notifications alt+T` and `Varsler alt+T`, polite announcement priority and `additions text` relevance in all three browsers. Both supported locales use left-to-right text. Sonner continues deriving direction from the document. Close-button copy is supplied for any toast that enables a close button; current application calls do not enable one, so these runs do not claim a rendered close-button or screen-reader audio check.

### Email theme and live props

`EmailLayout` uses the installed React Email 6.11.5 `theme` string with CSS `@theme` declarations. The palette and font names match the previous theme. `pixelBasedPreset` remains in `config` so spacing and typography stay compatible with email clients. The renderer resolves literal sRGB colors into inline declarations; recipients do not need CSS custom-property support. No client-compatibility warning filters were narrowed.

All 27 default preview exports now expose `PreviewProps` and forward editor overrides. Defaults are spread before supplied props because the installed `email export` CLI renders with no props, whereas the preview server supplies editor values. The first export attempt exposed that distinction; the corrected export succeeds for all 27 templates.

Representative defaults include a long Bokmål workspace name, a long recipient name, a null optional workspace name, localized digest content and an explicitly illustrative `9 999 999,99 kr` amount. Every preview exposes a locale value for the editor. The installed `@react-email/ui` preview code reads `emailComponent.PreviewProps`; the old no-argument wrappers hid those props from the editor.

## Optional web decisions

| Suggestion             | Evidence and disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React ViewTransition   | Retain current navigation. `DESIGN.md` requires immediate keyboard navigation and overlays. No workspace navigation continuity problem was identified. Adding transition ownership alongside Router's existing `viewTransition` option would add behavior without an acceptance target. React 19.3 availability alone does not justify it.                                                                                                                                                                                                                                    |
| TanStack FormGroup     | Retain the two forms. Creation has `name`, unrestricted workspace `scopes` and `expiry`. Replacement has only the old token's scopes and bounded `overlapSeconds`, inherits expiry and shows a different secret/refresh lifecycle. Only the scopes field overlaps, and it already uses `CheckboxSetField`. A group would need policy parameters without removing a repeated field group.                                                                                                                                                                                      |
| `cn/vite`              | Do not adopt. A measured browser-module probe scanned 598 source/content files and kept 133 of 384 groups with no warnings. Plain `cn` bundled to 26,757 bytes, 11,066 gzip; fitted tables plus `createCn` bundled to 21,113 bytes, 9,124 gzip. The 1,942 gzip-byte saving does not justify another generated artifact and a narrower class-merging contract here. This is an isolated production-mode module measurement, not an app-chunk or route-performance claim. The installed Vite plugin only runs table generation; it does not automatically replace `cn` imports. |
| Tailwind 4.3 utilities | Retain current CSS. The current scrollbar rule sets both thumb and track to semantic tokens. There is no repeated tab-size, zoom or scrollbar-gutter declaration to replace, and no measured overflow defect in this slice. Adding layout policy merely to consume new utilities would change behavior.                                                                                                                                                                                                                                                                       |

## Repeatable verification

Run from the repository root:

```sh
pnpm -C packages/i18n generate
pnpm -C packages/i18n check:unused
pnpm -C packages/email test
pnpm -C packages/email typecheck
pnpm -C apps/web typecheck
pnpm -C packages/email exec email export --dir src/previews --outDir /tmp/email-adoption-export
pnpm run db:migrate:local
pnpm run db:seed
E2E_PORT=3097 pnpm -C apps/web exec playwright test \
  e2e/passkeys.spec.ts e2e/strong-authentication.spec.ts \
  e2e/auth-request-ownership.spec.ts e2e/toast-accessibility.spec.ts \
  --workers=1 --trace=on
```

Observed results:

- Email tests: 41 passed across four files. The palette/pixel-spacing regression case was written and run before the theme change. Initial baseline startup needed i18n generation; after generation the baseline passed too.
- Email and web typechecks passed. Focused lint and i18n unused-message checks passed.
- Email export produced all 27 HTML files. The preview server rendered the long Bokmål invitation successfully. Interactive browser capture timed out, so visual/editor-interaction approval is not claimed.
- Impeccable's detector returned an empty finding array for the changed root, Toaster and email layout.
- Initial three-browser run: 82 passed, 11 skipped, two WebKit failures. The virtual conditional-mediation fix removed the interrupted-navigation failure.
- Confirmation with traces: 83 passed, 11 skipped, one WebKit failure. Registration, rename, usernameless sign-in and deletion passed in all three engines. The remaining failure is the pre-existing date-format hydration difference described below. Skips come from the dependency-expanded Chromium suite's optional-provider/local-runtime cases.
- Seeded shuffle on Chromium and Firefox passed: 77 passed, 11 skipped in 1.2 minutes. Repeat the E2E command with `E2E_PORT=3107 --project=chromium --project=firefox --workers=1 --shuffle=20261101`, placing the environment variable before `pnpm` and the flags after the test files. The first attempt found port 3097 still occupied during preview shutdown; the free-port run completed successfully.

For the live editor, run `pnpm -C packages/email dev --port 3098`, open `/preview/workspace-invitation` or `/preview/notification-digest`, and edit the exposed values. No new runtime dependency is required.

Repeat the `cn` module-size probe without changing the application:

```sh
node --input-type=module <<'JS'
import { build as fit } from './apps/web/node_modules/cn/dist/build.js'
import { build as bundle } from './apps/web/node_modules/esbuild/lib/main.js'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const out = join(tmpdir(), 'starter-cn-tables.mjs')
const cwd = process.cwd() + '/apps/web'
const fitted = await fit({ cwd, content: ['src/**/*.{ts,tsx}', 'content/**/*.mdx'], out })
console.log(fitted.scannedFiles, fitted.usedGroups, fitted.totalGroups, fitted.warnings)
for (const contents of [
  'export { cn } from "cn"',
  `import tables from '${out}'; import { createCn } from 'cn/engine'; export const cn = createCn(tables)`
]) {
  const result = await bundle({ stdin: { contents, resolveDir: cwd }, bundle: true, minify: true, format: 'esm', platform: 'browser', write: false })
  const bytes = result.outputFiles[0].contents
  console.log(bytes.length, gzipSync(bytes).length)
}
JS
```

### Hydration correction

The main session subsequently assigned `packages/i18n/src/format.ts` and its regression coverage to this worker. `/admin` renders `formatDateTime` values during SSR. With `{ dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Oslo' }`, Node rendered `Nov 1, 2026, 12:48 PM`, while installed WebKit rendered `Nov 1, 2026 at 12:48 PM`. That text mismatch caused React error 418. A baseline that navigated away before hydration sometimes passed, so the existing strong-authentication test now waits for the admin header's enabled locale control before leaving. Its browser-error assertion remains enabled.

The shared formatter now formats date and time styles independently and joins them with the comma separator used by both supported locales. This retains the requested style precision, timezone and hour-cycle options without adopting ICU-version-dependent combined-style connectors. Date-only, time-only and explicit-field options retain their prior paths; calendar dates still pin UTC. No hydration warning is suppressed.

Before changing the formatter, a browser probe bundled the actual `format.ts` module with esbuild and compared its Node and WebKit results. It exited 1 on the English medium-style case. After the change all eight combinations of English/Bokmål and short/medium/long/full date styles agreed, exiting 0. Existing formatting tests gained timezone, hour-cycle and calendar-date cases before implementation. The separate device-header regression also failed before the routing fix.

The focused i18n run passed 19 tests across four files, and the email regression run passed 41 tests. i18n/web typechecks and focused lint passed. Logs for this correction use the `web-format-` prefix in the session directory, including `parity-before.log`, `parity-after.log`, `unit-after.log`, `red.log`, and `green.log`. The baseline request-header failure is in `web-format-red.log`; `web-format-before.log` records the earlier timing-sensitive E2E pass before the explicit hydration wait was added.

The first post-fix run passed the new device-header assertion but later timed out locating the current session. Repeated runs had accumulated 142 disposable `usr_demo` sessions with test `10.*` addresses in the local compiled-preview database. The session list omitted the newest device. Those test-address sessions were removed between runs; non-test addresses and the separate Alchemy database were untouched. This was local test-state cleanup, not an application or session-policy change. The clean rerun log is `web-format-green-clean.log`.

The clean run passed 84 tests with 11 optional-provider skips in 1.7 minutes. It exercised two independent worker credentials, serialized browser projects, the restored device-IP header and the fully hydrated WebKit admin page. Repeat it with:

```sh
E2E_PORT=3147 pnpm -C apps/web exec playwright test \
  e2e/account-sessions.spec.ts e2e/passkeys.spec.ts \
  e2e/strong-authentication.spec.ts e2e/auth-request-ownership.spec.ts \
  e2e/toast-accessibility.spec.ts --workers=2 --trace=on
```

The passing WebKit trace was copied to the session directory as `web-format-webkit-green-trace.zip`, so subsequent Playwright runs cannot overwrite that evidence.

Repeat the actual formatter parity check without application state:

```sh
node --input-type=module <<'JS'
import { build } from './apps/web/node_modules/esbuild/lib/main.js'
import { webkit } from './apps/web/node_modules/@playwright/test/index.mjs'
import { formatDateTime } from './packages/i18n/src/format.ts'
const compiled = await build({ entryPoints: ['packages/i18n/src/format.ts'], bundle: true, format: 'iife', globalName: 'formatHelpers', write: false })
const browser = await webkit.launch()
const page = await browser.newPage()
await page.addScriptTag({ content: compiled.outputFiles[0].text })
let failures = 0
for (const locale of ['en', 'nb']) {
  for (const dateStyle of ['short', 'medium', 'long', 'full']) {
    const args = ['2026-11-01T11:48:00Z', locale, { dateStyle, timeStyle: 'short' }, 'Europe/Oslo']
    const server = formatDateTime(...args)
    const client = await page.evaluate(args => window.formatHelpers.formatDateTime(...args), args)
    console.log({ locale, dateStyle, server, client, equal: server === client })
    if (server !== client) failures += 1
  }
}
await browser.close()
process.exitCode = failures ? 1 : 0
JS
```

CI browser installation is owned by the main session; this worker did not edit CI.

Session logs are under `/private/var/folders/vw/bbmd8nsx5bq2_4l17l8qrjsc0000gn/T/opencode/`, named `web-email-before.log`, `web-email-baseline.log`, `web-email-after.log`, `web-email-types.log`, `web-types.log`, `web-lint.log`, `web-i18n-unused.log`, `web-email-export.log`, `web-cn-experiment.log`, `web-adoption-e2e.log`, `web-adoption-e2e-confirm.log`, and `web-adoption-shuffle.log`. Playwright's JSON result and per-test traces live under `apps/web/playwright-report` and `apps/web/test-results`; later runs replace them. These paths are local evidence, not committed artifacts.
