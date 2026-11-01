# Dependency tooling adoption

## Implemented

- Paraglide's `no-dynamic-message-access` runs through the existing Vite+/Oxlint JavaScript plugin interface. The root declares the plugin dependency and configures the shared messages package alias. A real-binary probe rejected both aliased dynamic indexing and a catalog spread, and accepted an explicit message map. Full-repository lint passed.
- Local lint rules import `vite-plus/lint/plugins`, using the same helper version as the bundled linter. The direct `@oxlint/plugins` dependency and catalog entry are removed. Existing real-binary rule tests and typechecks pass. The vendored anti-slop bundle is untouched.
- Effect's lint plugin is now 0.29.0. Existing rule selection remains explicit, with `noPointFreeLog` added. The updated global-access detection required two documented platform-adapter exemptions: correlation-id creation before application services exist, and restoring a Workers test's fetch adapter. The repository retains its host/browser exemptions. `requireSpawnBudget` remains opt-in: existing subprocess suites already use runner budgets, and this adoption does not mandate per-test duplication. No blanket locale-comparison or recommended-preset migration was applied.
- Fallow is now 3.38.1. Before/after diagnostics confirmed seven redundant dependency exceptions could be removed, preserving the zero-issue regression baseline. Explicit test entries and imported lint-plugin exceptions remain because diagnostics did not establish redundancy. The new Paraglide lint subpath also needs an exception because Fallow does not follow its registration through the imported root lint configuration.
- `pnpm run health` reports maintainability findings without failing for findings. `.fallowrc.json` sets a 1,000-line reporting threshold. A separate CI job publishes the report to the job summary. It does not gate the required CI job or replace measured test coverage. Generated output and vendored UI retain their existing exclusions.
- Trivy's binary pin is 0.76.1; the setup action comment now correctly identifies 0.3.1. The downloaded macOS ARM64 archive matched its published SHA-256, and the native Trivy exception tests passed with that binary.
- The unresolved pnpm setup pin is replaced with the dereferenced v6.1.0 commit. Both cache uses share v6.1.0. Artifact upload uses v7.0.2, retaining default zip behavior, unique names, paths and retention. The catalog updater's previously floating tag is pinned to its resolved 1.0.14 commit. These actions use Node 24 on the existing GitHub-hosted Ubuntu runners.

## Sources checked during implementation

- Installed Paraglide 2.29.3 `dist/eslint/no-dynamic-message-access.js` and its `sourceCode.getScope` usage; verified through the real bundled linter.
- Installed Vite+ 1.4.0 exported plugin types and existing custom-rule tests.
- [Effect lint 0.29.0](https://github.com/cevr/effect-oxlint/releases/tag/v0.29.0) and installed rule registry/README.
- Installed Fallow 3.38.1 CLI help and before/after JSON diagnostics.
- [pnpm setup v6.1.0 action](https://github.com/pnpm/action-setup/blob/ea17c68df8912ef543352723c149a84f56e3d413/action.yml), resolved through its annotated tag.
- [artifact upload v7.0.2 action](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/action.yml) and [release](https://github.com/actions/upload-artifact/releases/tag/v7.0.2).
- [Trivy 0.76.1 release and checksums](https://github.com/aquasecurity/trivy/releases/tag/v0.76.1).

## Initial advisory health observation

With Fallow 3.38.1 and the integrated adoption changes on 2026-11-01, the report scored 87.6, grade A. It analyzed 1,248 files and 14,486 functions, with 215 threshold findings including eight file-length findings. Its coverage model was `static_estimated`. These numbers are an observation for comparison, not a new acceptance gate or test-coverage claim. Regenerate with `pnpm exec fallow health --report-only --format json`; git-dependent hotspot counts can change with history.

## Remaining optional decisions

The ten ranked recommendations are implemented across this slice, [web/email](dependency-web-adoption.md), and [API](dependency-api-adoption.md). The audit's other entries include evaluations and explicit skips, rather than requirements to consume every new API:

- Keep pnpm 11.25.0 and the existing tsrs baseline. Catalog resolution and typechecking passed. The audit identified newer versions to evaluate but no current mismatch or checker failure that requires their changed defaults. Changing package-manager or checker semantics is unnecessary for these feature adoptions.
- Keep React Doctor's explicit current registry baseline. No new rule was identified as necessary for these changes. Vite+, Vitest, Wrangler, Miniflare, React Compiler and the patched Alchemy graph remain coordinated at the existing versions.
- Keep Effect-owned inference and tracing. Experimental Agents tracing would duplicate the established logger boundary without a demonstrated missing span. Circuit breakers need a concrete outbound outage policy; no such requirement was established. Header-only timeouts cannot replace existing whole-operation deadlines. The unstable JOSE module and MCP protocol upgrades have no current client requirement.
- Per-test Effect layers and MCP's in-memory test client do not replace the existing Worker/protocol regression checks, which passed. Better Auth's consent verification is already used by the provider. No additional auth mode or SAML rollout requirement was found.
- Web experiments and their measured or code-based dispositions are recorded in the web/email report. Maintenance-only package releases and already-adopted APIs retain the audit's decisions.

## Verification

From the repository root:

```sh
vp install --frozen-lockfile
pnpm run check
pnpm run validate
pnpm run health
TRIVY_BINARY=/path/to/verified/trivy vp test run .github/scripts/trivy.test.ts
```

The integrated `check` and `validate` passed. Validation included the production build and bundle guard, local migrations/seed, 84 compiled-preview browser tests with 11 optional-provider/runtime skips, and 15 Alchemy smoke tests. The first build found a new documentation example matching the bundle guard's server-code marker; the example now demonstrates the equally valid rate-limit problem without weakening the guard.

The first `check` attempt exceeded the shell's two-minute command budget. A six-minute-budget retry passed. The initial format check reported two files; formatting was corrected before the passing checks. No checks were disabled.

Logs are under the session temporary directory at `/private/var/folders/vw/bbmd8nsx5bq2_4l17l8qrjsc0000gn/T/opencode`, named `adoption-check.log`, `adoption-validate.log`, `adoption-trivy.log`, `adoption-health.json`, `fallow-before.json`, and `fallow-after.json`. These local files are supplementary; the commands above reproduce the checks. CI-only action execution still requires the PR runs.

## Review accounting

Implementation used GPT-6 Astra in the main session and two same-provider workers with separate web/email and API ownership. The web worker had one follow-up for the discovered cross-browser date-format mismatch and passkey routing behavior. Token, cache and billing counters were not exposed, so usage and cost are unknown. Review rounds and CI repairs are recorded in the PRs rather than inferred from token totals.
