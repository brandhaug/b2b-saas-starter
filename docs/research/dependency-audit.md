# Dependency audit

Reviewed 2026-09-07, starting at `ef17c133`. The audit covers all 19 workspace
manifests and their 88 distinct direct external dependencies, plus the lockfile's
advisories, deprecations, overrides, peer compatibility and direct-package license
metadata. It is not a source audit of every transitive package or a deployment
benchmark. Workspace packages are internal architectural boundaries.

Keep the core stack. Effect, TanStack Start, Better Auth, Drizzle and Alchemy fit
the Cloudflare-first starter and its provider-free local path. The worthwhile
library migration is React Email's supported consolidated package. The other
changes correct dependency ownership and security configuration.

## Changes selected and implemented

| Change                                                                                        | Reason                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace `@react-email/components` and direct `@react-email/render` imports with `react-email` | The installed React Email 6 package already exports components and rendering utilities. Its official migration guide retires the separate components package. This removes the deprecated component family while preserving the preview UI. `@react-email/render` remains a transitive implementation dependency. [Migration guide](https://react.email/docs/getting-started/updating-react-email) |
| Render email HTML once and derive text with `toPlainText`                                     | Uses the supported rendering API, preserves one typed failure boundary and avoids rendering the same React tree twice. No speedup is claimed without a benchmark. [Render API](https://react.email/docs/utilities/render)                                                                                                                                                                          |
| Replace direct Babel 7 typings with Babel 8's bundled types                                   | Installed `@babel/core@8.0.1` exports its own `.d.ts` files. The Rolldown adapter does not require the old DefinitelyTyped package. [Babel 8 release](https://babeljs.io/blog/2026/06/16/8.0.0/)                                                                                                                                                                                                   |
| Move MDX Rollup and Tailwind typography to devDependencies                                    | Their callers are the build configuration and CSS compiler. Paraglide stays a runtime dependency because generated code imports its URLPattern polyfill. This corrects manifests; it does not claim a Worker bundle reduction.                                                                                                                                                                     |
| Override only `@prisma/dev>valibot` to 1.4.2                                                  | Initial registry audit found one moderate advisory in Alchemy's development tooling, which pins 1.2.0. The fixed release is 1.4.2. Application schemas remain Effect. Remove the override when the parent updates its pin. [Advisory](https://github.com/advisories/GHSA-5qjj-4xww-7phc)                                                                                                           |
| Remove the extract-zip advisory suppression                                                   | `extract-zip` is absent from the starting lockfile. Keeping its exception could silently suppress a future reintroduction.                                                                                                                                                                                                                                                                         |
| Register TanStack's existing CSRF middleware for server functions                             | The custom `startInstance` had omitted the framework default. The configured middleware now rejects cross-site or unverifiable server-function requests while leaving router endpoints to their existing policies. No new dependency or handwritten origin validator. [TanStack server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)                   |
| Group coupled catalog upgrades                                                                | Better Auth and its plugins, Drizzle ORM/kit, React Email/UI, and Sentry SDKs now update together. Existing React, TanStack, Effect and toolchain policies remain in place.                                                                                                                                                                                                                        |

The email package becomes the runtime owner of `react-email`; the background
worker declares it only for its independent email-rendering tests. The browser
boundary guard also recognizes React Email 6's `react-email.element` marker.
Build and preview environments still need development dependencies installed.

## Alternatives evaluated

The [runtime assessment](./dependencies-runtime.md) and
[frontend assessment](./dependencies-frontend.md) record the use sites, primary
sources, alternatives and migration costs for the application packages.

| Current choice                  | Alternative considered                                 | Decision for this starter                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effect HTTP, Schema and AI      | Hono/tRPC, Zod/Valibot, a second AI SDK                | Keep one typed application model. None supplies a missing starter capability that justifies parallel contracts or rewritten capability adapters.                                          |
| Better Auth and plugins         | Hosted identity, lower-level WebAuthn/OAuth libraries  | Keep the working local credentials path, workspace membership and integrated security flows. Lower-level libraries move that maintenance into this repository.                            |
| Drizzle with Effect D1          | Raw D1 queries, another ORM                            | Keep shared schema and both intentional auth/application drivers. Preserve the existing atomic D1 batch adapter.                                                                          |
| TanStack Start/Query/Form/Table | Next.js/OpenNext, Astro, React Hook Form, native forms | Existing routes, auth boundaries, polling, forms and tables use the current features. No concrete deficiency warrants the rewrite.                                                        |
| cmdk                            | Base UI Autocomplete                                   | A plausible consolidation, but filtering, ranking and keyboard behavior would need rebuilding and verification. The current palette is already lazy-loaded. Retain.                       |
| Mermaid                         | Checked-in SVG or Mermaid Tiny                         | Removed. The one static diagram is now the checked-in `ArchitectureSchematic` SVG, so the renderer, its theme module and the MDX transform all went with it; do not add another renderer. |
| Paraglide                       | Lingui, i18next, only Intl                             | Keep generated typed messages shared by email/UI and request-local SSR locale state. Intl already handles formatting and cannot replace catalogs.                                         |
| Sentry/PostHog/Effect OTLP      | Raw vendor HTTP calls or native Workers OTLP           | Keep SDK integrations. Native export currently lacks the metrics needed to replace the full application exporter. Fix request scheduling separately if pursuing latency improvements.     |
| Alchemy                         | Terraform or hand-maintained Wrangler deployments      | Keep existing resource ownership and preview stages. Its prerelease status requires validation, but a replacement would rebuild working infrastructure behavior.                          |

## Tooling assessment

| Dependencies                                                                                                                       | Decision and evidence                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite-plus`, aliased `vite`, `vitest`, `@vitest/coverage-v8`                                                                       | Keep the coordinated toolchain. Vite+ explicitly requires its Vite alias and matching Vitest pin. Registry Vitest 5 is not an independent upgrade candidate while Vite+ 0.3.0 expects 4.1.11. [Vite+ migration rules](https://viteplus.dev/guide/migrate)                                                                                                                                                                                   |
| `typescript`, `@types/node`, `@cloudflare/workers-types`                                                                           | Keep the compiler and runtime-specific types. Node runs 24.20.0 here while Node types target 26; avoid assuming a typechecked Node 26 API exists on Node 24. A separate minimum-runtime check or Node 24 type alignment would address that policy gap. Cloudflare recommends generated app types but still supports Workers types for shared libraries. [Cloudflare types](https://developers.cloudflare.com/workers/languages/typescript/) |
| `oxlint`, `@oxlint/plugins`, `eslint-plugin-better-tailwindcss`, `oxlint-plugin-effect`, `oxlint-plugin-react-doctor`, `ultracite` | Keep the existing rule system. `lint.config.ts` consumes the plugin presets and Ultracite's anti-slop plugin. ESLint or Biome would require porting repository-specific rules. Oxlint supports the existing type-aware check. [Oxlint](https://oxc.rs/docs/guide/usage/linter/type-aware)                                                                                                                                                   |
| `fallow`                                                                                                                           | Keep the configured dependency, dead-code and cycle checks. Knip is a credible alternative for unused dependencies, but no missed dependency here establishes a benefit from maintaining a second graph or replacing the baseline. [Fallow](https://fallow.tools/docs/explanations/dead-code/), [Knip](https://knip.dev/typescript/unused-dependencies)                                                                                     |
| `shadcn`                                                                                                                           | Keep the CLI that maintains the vendored components. It is a development tool, not an additional runtime component framework.                                                                                                                                                                                                                                                                                                               |
| `@playwright/test`, `@testing-library/dom`, `@testing-library/react`, `jsdom`, `@effect/vitest`, `@cloudflare/vitest-pool-workers` | Keep complementary browser, component, Effect and workerd tests. Replacing them with one runner would lose runtime coverage or require recreating these integrations.                                                                                                                                                                                                                                                                       |
| Babel/Rolldown/React compiler and MDX/Tailwind plugins                                                                             | Keep the working compiler pipeline; remove only the redundant Babel typings and correct build-only declarations. The frontend assessment accounts for every plugin.                                                                                                                                                                                                                                                                         |

## Security and maintenance findings

The initial `pnpm audit --json` result reported 1 moderate, 0 high and 0 critical
advisories. Its dependency summary counted 1,732 dependencies, including optional
and development packages. The affected path was
`alchemy > @prisma/dev > valibot@1.2.0`. This does not establish exposure in the
deployed Workers. The scoped override fixes the resolved tooling dependency
without replacing application validation.

The starting lockfile marked `@react-email/components` and 19 individual
component packages as deprecated. The React Email consolidation addresses that
maintenance finding. The new library entry exports component modules and render
utilities; its CLI is a separate executable entry. Verify the actual Worker
bundle rather than inferring that its CLI dependencies ship to Workers.

Existing overrides for Hono, brace-expansion, fast-uri, ip-address, js-yaml,
lodash, nanoid, PostCSS, sharp, shell-quote, socket.io-parser, TOML, undici and ws
remain. Several are broad major-version overrides, so a clean advisory result
does not prove every optional third-party integration works. The current
application/tooling checks exercise the selected Cloudflare path. Narrow or
remove each override when its parents adopt fixed versions; do not remove them
all as cleanup. Keep Vite and Vitest overrides as toolchain coordination.

`pnpm peers check` reports one existing mismatch: `capnp-es@0.0.14` requests
TypeScript `^5.7.3`, while this repo uses 7.0.2. No new peer exemption was added.
The installed OAuth provider declaration patch remains tied to Better Auth
1.7.2 and should be retested when that family upgrades.

The registry freshness query completed. Newer releases are listed in the
inventory below, but ordinary patch/minor updates stay with the existing
three-day catalog update policy. The already-pinned Effect, Drizzle and Alchemy
prereleases are architecture choices, not evidence that an older stable major
is a compatible downgrade. The `effectful-better-auth@1.0.0` release-age exception
is package-version-specific, and the wrapper remains a small peer-based adapter.

Direct-package license metadata was inspected. Most entries identify MIT,
Apache-2.0 or ISC; the three Fontsource packages identify OFL-1.1.
`@inlang/plugin-message-format` omits a manifest license field but ships an MIT
LICENSE file. `oxlint-plugin-react-doctor` points to a Modified MIT LICENSE with
additional restrictions; it should not be described as plain MIT in a dependency
notice. This is a metadata inventory, not a legal compatibility assessment.

## Follow-up questions, separate from library replacements

- PostHog's configured HTTP sink is awaited before request completion. A
  request-owned background export could reduce response waiting, but must
  preserve queue/cron delivery and invocation lifetime semantics.
- MCP serves the tested `2025-11-25` transport revision. Supporting newer
  required client revisions is a feature decision, not an auth dependency bump.
- The custom CIMD transport's DNS/address-pinning guarantee needs a focused
  platform contract review. This audit did not verify an exploit or establish
  the complete guarantee from Cloudflare documentation.

These are recorded in the runtime assessment. They do not justify adding a
second SDK or replacing the current libraries during this migration.

## Validation

The final registry audit reports zero advisories and 1,706 total dependencies,
down from 1,732. Direct external dependencies fall from 88 to 85; all 20 deprecated
React Email lockfile entries are gone. The matching React Email preview server
responded successfully, and a background Worker dry-run bundle completed without
pulling React Email's CLI entry into the bundle. No deployment was performed.

Passed checks include workspace typechecking, the production build after the
CSRF integration, type-aware lint, formatting, the browser/server module boundary
check, dead-code analysis,
local Wrangler configuration generation without drift, D1 migrations and seed.
The separate suites passed 29 email tests, 95 background tests, 609 web tests,
36 agent/workflow script tests and 17 operations tests. The five new CSRF tests
also passed. Implementation and spec reviews found no remaining blocking issue.

`pnpm run validate` did not pass. Its capability suite passed 570 of 572 tests;
the retention test in `email-delivery.live.test.ts` exceeded 30 seconds and the
trial-expiry test in `resource-entitlements.live.test.ts` exceeded 5 seconds.
Both timed out again in a focused rerun. Their source and database adapter were
unchanged, but this audit did not establish a passing baseline on this machine.
The remaining suites and build were run separately because the validation script
stops at the first failure. No test timeout was increased.

The first Chromium run passed 26 of 27 tests; the other-device session-revocation
case timed out waiting for the workspace selector to become interactive. The
post-CSRF Chromium run passed all 27 tests with two workers and the existing
timeouts. This covers sign-in, session revocation, passkeys, workspace settings,
audit inspection, locale switching and smoke flows.

## Complete direct dependency inventory

Versions are the starting catalog pins and registry `latest` values observed
during this audit. `vite` is an npm alias for `@voidzero-dev/vite-plus-core`.
Repeated workspace declarations are counted once. Detailed keep decisions are
in the assessments above; this table provides the exhaustive version checklist.

| Dependency                         | Starting pin                             | Registry latest      | Decision                                     |
| ---------------------------------- | ---------------------------------------- | -------------------- | -------------------------------------------- |
| `@babel/core`                      | `8.0.1`                                  | `8.0.1`              | Keep                                         |
| `@base-ui/react`                   | `1.8.0`                                  | `1.8.0`              | Keep                                         |
| `@better-auth/cimd`                | `1.7.2`                                  | `1.7.3`              | Keep                                         |
| `@better-auth/mcp`                 | `1.7.2`                                  | `1.7.3`              | Keep                                         |
| `@better-auth/oauth-provider`      | `1.7.2`                                  | `1.7.3`              | Keep                                         |
| `@better-auth/passkey`             | `1.7.2`                                  | `1.7.3`              | Keep                                         |
| `@better-auth/sso`                 | `1.7.2`                                  | `1.7.3`              | Keep                                         |
| `@cloudflare/vitest-pool-workers`  | `0.22.0`                                 | `0.22.0`             | Keep                                         |
| `@cloudflare/workers-types`        | `5.20260904.1`                           | `5.20260906.1`       | Keep                                         |
| `@effect/platform-node`            | `4.0.0-rc.112`                           | `4.0.0-rc.112`       | Keep                                         |
| `@effect/sql-d1`                   | `4.0.0-rc.112`                           | `4.0.0-rc.112`       | Keep                                         |
| `@effect/vitest`                   | `4.0.0-rc.112`                           | `4.0.0-rc.112`       | Keep                                         |
| `@fontsource-variable/geist`       | `5.3.0`                                  | `5.3.0`              | Keep                                         |
| `@fontsource-variable/geist-mono`  | `5.3.0`                                  | `5.3.0`              | Keep                                         |
| `@fontsource-variable/newsreader`  | `5.3.0`                                  | `5.3.0`              | Keep                                         |
| `@inlang/paraglide-js`             | `2.25.0`                                 | `2.25.0`             | Keep runtime polyfill dependency             |
| `@inlang/plugin-message-format`    | `4.4.4`                                  | `4.4.4`              | Keep                                         |
| `@mdx-js/rollup`                   | `3.1.1`                                  | `3.1.1`              | Keep; move to devDependencies                |
| `@oxlint/plugins`                  | `1.80.0`                                 | `1.81.0`             | Keep                                         |
| `@playwright/test`                 | `1.62.1`                                 | `1.63.0`             | Keep                                         |
| `@react-email/components`          | `1.0.12`                                 | `1.0.12`             | Migrate to react-email                       |
| `@react-email/render`              | `2.1.0`                                  | `2.1.0`              | Use react-email exports; retain transitively |
| `@react-email/ui`                  | `6.9.3`                                  | `6.9.3`              | Keep                                         |
| `@rolldown/plugin-babel`           | `0.2.3`                                  | `0.2.3`              | Keep                                         |
| `@sentry/cloudflare`               | `10.73.0`                                | `10.73.0`            | Keep                                         |
| `@sentry/react`                    | `10.73.0`                                | `10.73.0`            | Keep                                         |
| `@tailwindcss/typography`          | `0.5.20`                                 | `0.5.20`             | Keep; move to devDependencies                |
| `@tailwindcss/vite`                | `4.3.3`                                  | `4.3.3`              | Keep                                         |
| `@tanstack/devtools-vite`          | `0.8.5`                                  | `0.8.5`              | Keep                                         |
| `@tanstack/react-form`             | `1.33.5`                                 | `1.33.5`             | Keep                                         |
| `@tanstack/react-query`            | `5.102.8`                                | `5.102.8`            | Keep                                         |
| `@tanstack/react-router`           | `1.170.32`                               | `1.170.32`           | Keep                                         |
| `@tanstack/react-router-devtools`  | `1.167.1`                                | `1.167.1`            | Keep                                         |
| `@tanstack/react-router-ssr-query` | `1.167.2`                                | `1.167.2`            | Keep                                         |
| `@tanstack/react-start`            | `1.168.49`                               | `1.168.49`           | Keep                                         |
| `@tanstack/react-table`            | `9.2.3`                                  | `9.2.4`              | Keep                                         |
| `@testing-library/dom`             | `10.4.1`                                 | `10.4.1`             | Keep                                         |
| `@testing-library/react`           | `16.3.3`                                 | `16.3.3`             | Keep                                         |
| `@types/babel__core`               | `7.20.5`                                 | `7.20.5`             | Remove; bundled Babel types                  |
| `@types/mdx`                       | `2.0.14`                                 | `2.0.14`             | Keep                                         |
| `@types/node`                      | `26.4.0`                                 | `26.4.1`             | Keep                                         |
| `@types/react`                     | `19.2.18`                                | `19.2.18`            | Keep                                         |
| `@types/react-dom`                 | `19.2.5`                                 | `19.2.7`             | Keep                                         |
| `@vitejs/plugin-react`             | `6.1.1`                                  | `6.1.1`              | Keep                                         |
| `@vitest/coverage-v8`              | `4.1.11`                                 | `5.0.0`              | Keep                                         |
| `alchemy`                          | `2.0.0-beta.76`                          | `2.0.0-beta.76`      | Keep                                         |
| `babel-plugin-react-compiler`      | `1.0.0`                                  | `1.0.0`              | Keep                                         |
| `better-auth`                      | `1.7.2`                                  | `1.7.3`              | Keep                                         |
| `class-variance-authority`         | `0.7.1`                                  | `0.7.1`              | Keep                                         |
| `clsx`                             | `2.1.1`                                  | `2.1.1`              | Keep                                         |
| `cmdk`                             | `1.1.1`                                  | `1.1.1`              | Keep                                         |
| `drizzle-kit`                      | `1.0.0-rc.5-ab785fc`                     | `1.0.0-rc.5-ab785fc` | Keep                                         |
| `drizzle-orm`                      | `1.0.0-rc.5-ab785fc`                     | `1.0.0-rc.5-ab785fc` | Keep                                         |
| `effect`                           | `4.0.0-rc.112`                           | `4.0.0-rc.112`       | Keep                                         |
| `effectful-better-auth`            | `1.0.0`                                  | `1.0.1`              | Keep                                         |
| `eslint-plugin-better-tailwindcss` | `4.7.0`                                  | `4.7.0`              | Keep                                         |
| `fallow`                           | `3.22.0`                                 | `3.22.0`             | Keep                                         |
| `jose`                             | `6.2.10`                                 | `6.2.12`             | Keep                                         |
| `jsdom`                            | `30.0.1`                                 | `30.0.1`             | Keep                                         |
| `lucide-react`                     | `1.40.0`                                 | `1.41.0`             | Keep                                         |
| `oxlint`                           | `1.80.0`                                 | `1.81.0`             | Keep                                         |
| `oxlint-plugin-effect`             | `0.11.0`                                 | `0.12.1`             | Keep                                         |
| `oxlint-plugin-react-doctor`       | `0.9.12`                                 | `0.9.13`             | Keep                                         |
| `posthog-js`                       | `1.426.2`                                | `1.427.2`            | Keep                                         |
| `posthog-node`                     | `5.51.4`                                 | `5.51.6`             | Keep                                         |
| `qrcode.react`                     | `^4.2.0`                                 | `4.2.0`              | Keep                                         |
| `react`                            | `19.2.8`                                 | `19.2.8`             | Keep                                         |
| `react-dom`                        | `19.2.8`                                 | `19.2.8`             | Keep                                         |
| `react-email`                      | `6.9.3`                                  | `6.9.3`              | Keep; make email runtime dependency          |
| `rehype-pretty-code`               | `0.14.5`                                 | `0.14.5`             | Keep                                         |
| `rehype-slug`                      | `6.0.0`                                  | `6.0.0`              | Keep                                         |
| `remark-frontmatter`               | `5.0.0`                                  | `5.0.0`              | Keep                                         |
| `remark-gfm`                       | `4.0.1`                                  | `4.0.1`              | Keep                                         |
| `remark-mdx-frontmatter`           | `5.2.0`                                  | `5.2.0`              | Keep                                         |
| `shadcn`                           | `4.21.0`                                 | `4.21.0`             | Keep                                         |
| `sonner`                           | `2.0.8`                                  | `2.0.8`              | Keep                                         |
| `standardwebhooks`                 | `1.1.1`                                  | `1.1.1`              | Keep                                         |
| `tailwind-merge`                   | `3.6.0`                                  | `3.6.0`              | Keep                                         |
| `tailwindcss`                      | `4.3.3`                                  | `4.3.3`              | Keep                                         |
| `tw-animate-css`                   | `1.4.0`                                  | `1.4.0`              | Keep                                         |
| `typescript`                       | `7.0.2`                                  | `7.0.2`              | Keep                                         |
| `ultracite`                        | `7.10.7`                                 | `7.11.0`             | Keep                                         |
| `vite`                             | `npm:@voidzero-dev/vite-plus-core@0.3.0` | `0.3.0`              | Keep                                         |
| `vite-plus`                        | `0.3.0`                                  | `0.3.0`              | Keep                                         |
| `vitest`                           | `4.1.11`                                 | `5.0.0`              | Keep                                         |
| `wrangler`                         | `4.129.0`                                | `4.129.0`            | Keep                                         |
