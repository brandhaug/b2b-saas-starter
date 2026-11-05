# Upstream code conventions comparison

Adopt owned-process cleanup, explicit lint-suppression reasons, and better
first-attempt failure evidence. Consider offline provider-test enforcement and
source-backed model evaluations. Keep the starter's existing formatting, typed
failures, capability boundaries and E2E-first policy. Most of the attractive
upstream readability rules are already adopted here.

## Snapshots and scope

Inspected on 2026-11-05 using GitHub's API and commit-pinned source archives.

| Repository                                                  | Branch           | Inspected commit                           | Commit time, UTC              |
| ----------------------------------------------------------- | ---------------- | ------------------------------------------ | ----------------------------- |
| [anomalyco/opencode](https://github.com/anomalyco/opencode) | `dev`            | `42be645ad71cd072398ef5f8053986c438512779` | 2026-11-05 08:17:47           |
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code)     | `main`           | `67eebaca23f8f7bc46e8817434087fc9c5acf8e3` | 2026-11-05 04:22:36           |
| Local starter                                               | current checkout | `428265bd4592a4af88000248995d10677886cbb5` | baseline for local references |

`t3ping` remains ambiguous. GitHub repository search for `t3ping` returned zero
results. Search for `t3 ping`, plus the public repository lists of `pingdotgg` and
`t3-oss`, did not establish a separate first-party project with that name.
`pingdotgg/t3code` identifies `https://t3.codes` as its homepage. It is the confirmed
T3 Code source, not evidence that a separate T3 Ping repository exists. No
UploadThing, Create T3 App, or third-party fork was substituted. A URL is needed
to audit that part of the request. Public discovery cannot exclude a private or
renamed repository.

Discovery is repeatable with `gh api repos/anomalyco/opencode`,
`gh api repos/anomalyco/opencode/commits/dev`,
`gh api repos/pingdotgg/t3code/commits/main`,
`gh api 'search/repositories?q=t3ping&per_page=10'`, and
`gh api orgs/pingdotgg/repos --paginate`. Source archives came from
`repos/{owner}/{repo}/tarball/{sha}`. Both confirmed repositories were accessible.

This is a bounded source cross-section, not a whole-repository correctness review:

- OpenCode: current lint and CI configuration, schema guidance and encode tests,
  Credential service and shared-work ownership, the Effect test runtime, E2E
  guidance and Playwright configuration. The
  [November 4 audit](opencode-code-style-source-audit.md) was read first; its
  historical claims are not treated as observations of today's head.
- T3 Code: root and Effect guidance, Vite+/lint configuration, CI, suppression
  rule and fixtures, timeout/quarantine rule, actual file-loading service and
  filesystem test, browser render cleanup, dev-process construction, and model
  evaluation guidance and runner.
- Starter: root/scoped guidance, code conventions, contribution acceptance and PR
  template, lint/plugin configuration, formatting, CI and its retry wrapper,
  Playwright configuration, notification Seed/Live implementation, real D1
  concurrency coverage, public-error serialization tests, and AI adapters' tests
  and instructions.

No dependencies were installed. No upstream or local runtime tests, model
evaluations, lint probes, or performance measurements were executed. Assertions
below describe inspected code, not passing runs. Only this report was added.
Local paths and line numbers refer to the baseline above.

The report-only formatting command,
`vp fmt docs/research/upstream-code-conventions-comparison.md --write`, could not
load the repository configuration because local `vite-plus` dependencies are
absent. No installation was attempted.

## Ranked adoption candidates

| Rank | Category         | Recommendation                                                     | Local landing point                                                                                      | Acceptance evidence for a later change                                                                                                         |
| ---- | ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Code conventions | Stop only processes the runner owns                                | `.github/scripts/run-check.ts:7-8,35-40`; existing dev-process owner                                     | A failed/cancelled run cleans up its process tree while an unrelated test server remains alive; preserve exit status and logs                  |
| 2    | Testing          | Keep first-attempt traces and make retries explicit evidence       | `apps/web/playwright.config.ts:17-22`; `.github/scripts/run-check.ts:24-40`; existing CI artifact upload | Deliberately fail one browser assertion, inspect the first attempt's trace, and verify a retry success remains visible in the reported outcome |
| 3    | Code style       | Require a reason for each lint suppression                         | `lint.config.ts`; `packages/oxlint-plugin/src/rules/`; existing rule fixtures                            | Probe bundled rules first; unexplained directives fail, justified ones pass, unused directives still fail                                      |
| 4    | Testing          | Refuse unexpected external requests in isolated provider tests     | `packages/ai` test setup and existing transport fixtures                                                 | An unstubbed external request fails the test even when application code catches it; intentional loopback integration still works               |
| 5    | Testing          | Add a small opt-in evaluation when changing assistant instructions | `packages/ai/src/assistant-instructions.ts`; a colocated evaluation entrypoint                           | Import production instructions, record model/settings/cases and baseline output, test actual responses to known failures and ordinary controls |
| 6    | Testing          | Enforce existing no-wait/no-timeout-inflation rules selectively    | Existing lint config/plugin, after bundled-rule probes                                                   | Syntax fixtures cover forbidden overrides and valid event-driven waits without weakening existing focused/skipped-test bans                    |

Ranks 1 and 3 are new upstream conventions with concrete local landing points.
Rank 2 is a local discrepancy exposed by comparison, not an upstream configuration
to copy. Rank 4 revisits a conditional recommendation in yesterday's audit with
additional local evidence. Rank 5 is new but conditional on model-facing changes.
Rank 6 adds enforcement to an existing rule; no current sleep-based regression was
established by this sample.

## Code style

### Require reasons for suppressions

T3 Code enables `require-suppression-reason` at error level. Its implementation
accepts a directive's justification or an adjacent preceding explanation; tests
cover file-level directives, stacked comments, JSX, and TypeScript directives.
This is executable policy, not merely an AGENTS preference.
[Configuration][t3-lint], [rule][t3-reasons], [fixtures][t3-reason-tests].

The starter already rejects unused suppressions in `lint.config.ts:422-424` and
requires TypeScript suppression descriptions at `lint.config.ts:484`. Many local
lint directives already explain themselves. The missing part is consistent
enforcement for lint reasons: `packages/capabilities/src/billing/checkout-test-fixtures.ts:7`
disables several rules without an adjacent explanation.

Preserve useful existing explanations. For example,
`apps/web/src/components/form-text-field.tsx:17-20` explains its untyped validator
boundary immediately _after_ the directive. A literal upstream port would reject
that layout. Normalize it deliberately or accommodate it with a tested rule;
do not label it unexplained. The upstream rule also accepts any nonempty adjacent
comment, which cannot prove that a reason is meaningful. Review still matters.

Probe the bundled plugins before adding a rule. Keep local path scoping, no-fixer
policy and real-binary fixtures. Do not duplicate the existing TypeScript rule.

### Keep the current readability and formatting policy

Main-operation-first ordering, meaningful extraction, inferred locals, early
returns, one owning decode boundary, pure synchronous calculations, execution
ownership and named `Effect.fn` are already explicit in
`docs/agents/code-conventions.md:6-99`. Existing custom rules enforce selected
parts. Recommending those as new gaps would repeat yesterday's work.

T3's source uses semicolons, double quotes and Effect subpath namespace imports;
OpenCode's Credential source uses root Effect imports and no semicolons.
[T3 service][t3-loader], [OpenCode service][oc-credential]. The projects disagree
on these details while sharing sound service boundaries. Retain the local
88-column, single-quote, no-semicolon format in `vite.config.ts:20-24`, named
exports and public Effect contracts.

Do not adopt T3's four-line comment cap or mandatory explanation on every React
effect as a blanket policy. Its root guidance states these preferences, but local
comments about D1 atomicity and Worker lifetimes can need more space. Local
React/Effect rules already cover many mechanical mistakes. [T3 taste][t3-taste].

## Code conventions

### Extend execution ownership to test-runner processes

T3's root guidance says to stop only a process captured at spawn or otherwise
verified as owned. Its dev runner constructs a child, retains the handle and
awaits its exit; it specifies signal/process-group behavior and a bounded forced
termination period. [Process rule][t3-process-rule], [runner][t3-process].

The starter's `.github/scripts/run-check.ts:35-40` runs `pkill -f` for `vite dev`,
`vite preview` and `workerd` before retrying E2E. Those names identify software,
not the failed invocation's processes. An isolated CI runner reduces collateral
exposure, but the script itself does not establish ownership and is executable
locally. This is a specific convention worth adopting for test/dev tooling.

A later fix should use the existing server owner or a captured process-tree
lifetime and preserve cancellation, logs and exit codes. Do not copy T3's exact
`detached: false` setting without checking the starter's Playwright/pnpm process
tree. Its signal behavior is an implementation choice, not a portable recipe.

### Preserve capability ownership and cross-entry-point acceptance

T3's service guide puts filesystem work, rollback and retry policy in services;
transports decode, call and map errors. Its `T3ProjectFileLoader` actually captures
filesystem/path dependencies at layer construction, compiles its decoder once,
and maps read/decode failures into the documented optional result. Its focused
test writes malformed JSON to a real scoped temporary directory.
[Service guide][t3-services], [implementation][t3-loader], [test][t3-loader-test].

These are confirmations of local strengths. `packages/capabilities/AGENTS.md:3-5,34-48`
already owns business behavior and Seed/Live equivalence.
`notification-preferences.ts:88-98,144-203` shares policy and uses the audited D1
mutation owner. T3's recoverable missing-config fallback is sensible for that
service, but optional results must not hide local database failures that should
be `CapabilityUnavailable`.

T3's entry-point and reverse-state checklist also has already-adopted equivalents
in `CONTRIBUTING.md:13-37` and the PR template. Keep local permission-denial,
Seed/Live and recovery evidence. Do not introduce a second acceptance matrix or
automatically expose every capability through MCP. [T3 checklist][t3-surfaces].

### Keep error and schema guarantees stronger than upstream defaults

OpenCode's current Credential service converts database failures to defects with
`Effect.orDie`; its shared-refresh operation documents who owns concurrent work.
Retain the ownership precision, but preserve local typed infrastructure failures.
[Credential][oc-credential]. T3's safe error attributes and cause separation also
fit existing local behavior: `packages/ai/src/openai.test.ts:150-170` checks that
transport diagnostics and credentials do not reach the returned reason.
[T3 error policy][t3-errors].

Canonical schemas and encode-side checks are already present locally.
`packages/api/AGENTS.md:14-22` forbids schema redeclaration;
`packages/api/src/problems.test.ts:12-74` verifies redaction, encode/decode behavior
and generated OpenAPI responses. OpenCode's optional-field transformation and
omission test remains a useful example for future changed wire contracts, not
evidence that the starter lacks serialization tests. [Encode test][oc-encode].

## Testing

### Preserve the first failure and reconcile retry policy

The starter's root policy asks for diagnosis from first-attempt evidence.
Playwright currently uses one CI retry and `trace: 'on-first-retry'`, so a test's
original failure has no trace from that setting. The CI wrapper retries the
entire command again and returns zero if a later command succeeds.
`.github/scripts/run-check.ts:11-16,24-40` preserves existing result directories,
and `.github/workflows/ci.yml:147-162` uploads them. Preserving directories cannot
recover a trace that was never recorded.

Prefer retaining traces from the failed original attempt and explicitly reporting
flaky/retried outcomes. Decide whether an assertion failure may become green on
retry, separately from a startup/infrastructure retry. Record that decision in
the existing runner policy. Do not simply increase deadlines.

OpenCode is a counterexample here: its E2E guidance rejects retries hiding flakes,
yet its Playwright configuration uses two CI retries and retry-only traces.
T3's test rule prohibits per-test timeout/retry overrides, but that syntax rule
cannot establish all CI retry behavior. [OpenCode guidance][oc-e2e],
[OpenCode config][oc-playwright], [T3 timeout rule][t3-timeouts].

### Make offline provider tests fail on attempted traffic

OpenCode's test runtime substitutes the Effect fetch service. It records forbidden
external attempts and fails after the test body, even when application recovery
swallows the request error. It allows loopback traffic and explicit test clients.
[Network refusal][oc-network].

The starter's OpenAI tests stub and restore global fetch per case. The AI package
test script is `vp test run`; the inspected AI/package and capabilities configs
show no equivalent default network-refusal setup. This establishes a limited
gap in the sampled setup, not a claim that every local test can reach the network.
`packages/ai/src/openai.test.ts:12-39` already has good explicit transport fixtures
and uses a real loopback server for redirect behavior.

Start with isolated AI/provider tests. Cover the actual native-fetch and Effect
client paths used there, restore state per test, and retain the real local D1 and
loopback integrations. A service-only interception is not proof that direct
global fetch is blocked. Prove a caught unexpected request still fails the test.

### Evaluate model behavior when changing model-facing instructions

T3 distinguishes deterministic tests from model evaluations. Its evaluation guide
requires source imports, sourced cases, ordinary control cases, repeated samples,
same-model baselines and saved results. Paid calls are opt-in, outside ordinary
CI. Its title runner actually calls production generation, rejects changed linked
context against the baseline, and writes result/review files with blinded ordering.
[Evaluation policy][t3-evals], [runner][t3-eval-runner].

Local `packages/ai/src/stateless.test.ts:11-36` checks that instructions reach a
stubbed model. It does not establish that a real model distinguishes queued from
delivered or treats hostile evidence as data. Those are explicit requirements in
`packages/ai/src/assistant-instructions.ts:1-4`.

When changing that text, use a small opt-in evaluation importing the production
instruction function and adapter. Start with a reproduced wrong answer, an
ordinary answer control and evidence containing misleading instructions. Record
the exact model/settings, outputs, rubric, repeated samples and cost. Keep
deterministic enforcement and authorization tests authoritative; a model score
cannot prove a security boundary. Do not copy T3's particular majority threshold
or create a general evaluation platform before a concrete case warrants it.

### Add narrow enforcement without weakening existing tests

T3 enables syntax rules for waits, polling, elapsed-time assertions and per-test
timeouts. The starter already documents deterministic synchronization and has
real examples: `resource-entitlements.live.test.ts:259-313` gates concurrent D1
rotations with a `Deferred`, and `packages/ai/src/stateless.test.ts:39-65` waits
for body consumption before advancing `TestClock` and checking cancellation.
[T3 lint][t3-lint].

An enforcement patch is lower priority than the concrete runner discrepancy.
First probe current Effect/Vitest rules. Retain the existing
`vitest/no-focused-tests` and `vitest/no-disabled-tests` policy in
`lint.config.ts:103-105`; T3's quarantine rule permits those forms with an issue
comment. Also do not import its `.live.test.ts` timeout exemption: upstream uses
that suffix for real provider turns, while the starter uses it for ordinary D1
integration. Its filename gating belongs in the starter's root config if adapted.
[Rule matching and exemptions][t3-timeouts].

T3's disposable browser render helper is useful if local component-test cleanup
becomes a concrete problem. It unmounts on failure and owns its DOM container.
It is not grounds to migrate the existing suite to browser-component tests or
delete full-stack E2E coverage. [Render helper][t3-render].

## Practices to leave upstream

- OpenCode's lint configuration disables all built-in categories and ratchets
  warning diagnostics only for touched GUI files. The starter enables correctness,
  suspicious and performance categories at error level and checks the whole tree.
  Preserve that bar. [OpenCode lint][oc-lint], [CI][oc-ci]; local
  `lint.config.ts:433-468`, `package.json:36`.
- T3's changed-file checks and affected-job CI are scale optimizations. They do not
  justify replacing local `check`/`validate` without measured cost and reliable
  dependency coverage. T3's root says CI owns full suites, while actual PR CI
  selects affected jobs; main pushes run all Linux jobs. [T3 verification][t3-verifying],
  [CI implementation][t3-ci].
- T3's instruction to test at the lowest failing layer should not remove the
  starter's distinct authorization and transport coverage. Shared assertions can
  stay shared while each public entry point proves its own wiring.
- Do not copy real developer databases into this multi-tenant starter merely
  because T3 seeds local development that way. Its dedicated pruning workflow
  serves a different product. Keep synthetic demo fixtures and Seed/Live parity.
  [T3 test data][t3-data].
- OpenCode's Solid UI, global credential-work scope and compatibility schemas,
  and T3's Node process services are product/runtime choices. Preserve React,
  Cloudflare request ownership, D1 batch atomicity and the starter's no-legacy-shim
  posture. No Bun migration, namespace rewrite or formatter change is justified.

## Pinned primary sources

[oc-credential]: https://github.com/anomalyco/opencode/blob/42be645ad71cd072398ef5f8053986c438512779/packages/core/src/credential.ts#L39-L148
[oc-network]: https://github.com/anomalyco/opencode/blob/42be645ad71cd072398ef5f8053986c438512779/packages/core/test/lib/effect.ts#L10-L80
[oc-encode]: https://github.com/anomalyco/opencode/blob/42be645ad71cd072398ef5f8053986c438512779/packages/schema/test/contract-hygiene.test.ts#L49-L85
[oc-e2e]: https://github.com/anomalyco/opencode/blob/42be645ad71cd072398ef5f8053986c438512779/packages/app/e2e/AGENTS.md#L6-L25
[oc-playwright]: https://github.com/anomalyco/opencode/blob/42be645ad71cd072398ef5f8053986c438512779/packages/app/playwright.config.ts#L32-L65
[oc-lint]: https://github.com/anomalyco/opencode/blob/42be645ad71cd072398ef5f8053986c438512779/.oxlintrc.json#L7-L55
[oc-ci]: https://github.com/anomalyco/opencode/blob/42be645ad71cd072398ef5f8053986c438512779/.github/workflows/check.yml#L30-L43
[t3-lint]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/vite.config.ts#L283-L301
[t3-reasons]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/oxlint-plugin-t3code/rules/require-suppression-reason.ts#L1-L62
[t3-reason-tests]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/oxlint-plugin-t3code/rules/require-suppression-reason.test.ts#L9-L117
[t3-timeouts]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/oxlint-plugin-t3code/rules/no-test-timeout-or-unreasoned-skip.ts#L6-L159
[t3-loader]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/apps/server/src/project/T3ProjectFileLoader.ts#L1-L93
[t3-loader-test]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/apps/server/src/project/T3ProjectFileLoader.test.ts#L11-L43
[t3-services]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/docs/internals/effect-services.md#L9-L90
[t3-errors]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/docs/internals/effect-services.md#L124-L154
[t3-process-rule]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/AGENTS.md#L59-L63
[t3-process]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/scripts/dev-runner.ts#L865-L901
[t3-surfaces]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/AGENTS.md#L65-L76
[t3-verifying]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/AGENTS.md#L99-L126
[t3-taste]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/AGENTS.md#L192-L207
[t3-data]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/AGENTS.md#L89-L97
[t3-render]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/apps/web/test/render.tsx#L66-L110
[t3-evals]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/evals/README.md#L3-L47
[t3-eval-runner]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/evals/thread-titles/run.ts#L58-L139
[t3-ci]: https://github.com/pingdotgg/t3code/blob/67eebaca23f8f7bc46e8817434087fc9c5acf8e3/.github/workflows/ci.yml#L17-L60
