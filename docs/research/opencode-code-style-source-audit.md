# OpenCode code-style source audit

Copy OpenCode's explicit contract ownership, boundary validation discipline, focused regression tests, and comments explaining concrete constraints. Keep the starter's stricter typed failures, Cloudflare composition, React conventions, and existing lint enforcement. A wholesale style transplant would weaken several existing guarantees.

## Snapshot and scope

Audited on 2026-11-04. GitHub's `commits/dev` API and a separate shallow clone both resolved `dev` to **`59e95cc5394b7714451608099ef4db7bffc904b6`**, committed at `2026-11-04T06:35:27Z`. [Commit][commit]. All upstream links below pin that revision.

This is current V2 source. The root package reports version `2.2.5`, Bun `1.4.4`, and Effect `4.1.0`; CONTRIBUTING explicitly says `bun dev` runs the V2 CLI/TUI and identifies the Schema/Core/Protocol/Server/Client packages. [Package][package], [contributing][contributing]. It would be wrong to describe this snapshot as the old monolithic `packages/opencode` application or recommend Zod as its primary domain-contract style.

V1 still exists as compatibility input. The schema guide requires current contracts to be unversioned, legacy contracts to be explicitly V1, and new code to avoid `src/v1`. Its isolation test checks canonical compatibility re-export identity. Current Credential also decodes pre-2.1 stored values. Those are migration accommodations, not conventions the no-production-users starter should adopt. [Schema guidance][schema-guide], [V1 tests][v1-tests], [Credential service][credential-service]. A `button-v2` CSS marker also survives in current UI code; a V2 suffix alone does not classify a file as the replacement backend architecture. [Button][button].

The audit reads root and relevant scoped guidance, formatter/linter/CI configuration, a complete credential contract-to-handler-to-service path, schema helpers and tests, a Cloudflare storage adapter, a UI controller and button/stories, browser regression code, and concurrency/security tests. It is a cross-section of the repository, not a claim that every source file was reviewed. No upstream dependencies were installed and no upstream tests were executed. Test findings describe inspected assertions, not observed passing runs.

Local fit was checked against `ARCHITECTURE.md`, `vite.config.ts`, `lint.config.ts`, and the capabilities, API, web, and oxlint-plugin intent nodes, followed by the source inspection below. Local baseline: `711c6482b31144b22e125ecf94c8aaccccb4db41`. This audit adds only this research file.

## Documented conventions versus enforcement

| Area            | Documented convention                                                                                                          | Inspected implementation or enforcement                                                                                                                                                                                         | Starter recommendation                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership       | Schema contracts feed Core and Protocol; Server composes them; clients must not import Core/Server.                            | Credential schemas are imported by Protocol, runtime behavior is in Core, and Server adapts calls. [Root guide][root-guide], [credential contract][credential-protocol], [handler][credential-handler].                         | Preserve the equivalent capability/HTTP/app split. Do not add a separate schema package merely to mirror upstream.                                                    |
| Validation      | Validate unknown data once at its owning boundary; pass typed values inward.                                                   | `Credential.CreateInput` is the endpoint payload; the handler passes the decoded payload into the service. [Root style][root-style], [credential contract][credential-protocol], [handler][credential-handler].                 | Adopt the wording. Local web guidance already specifies this for server-function inputs. Distinguish decoding from current authorization and invariant checks.        |
| Function shape  | Keep simple logic together; extract reused logic or a meaningful complex boundary. Main exports should read as the happy path. | Credential has local transaction helpers; the handler places the `entries` transformation below the export. [Root style][root-style], [Credential service][credential-service], [handler][credential-handler].                  | Good default. Avoid interpreting “one function” as permission for unbounded orchestration.                                                                            |
| Types           | Infer local types; explicit exported interfaces when useful; avoid `any`.                                                      | Credential declares its service interface explicitly. Tool guidance deliberately permits `any` after heterogeneous registration. [Credential service][credential-service], [tool guide][tool-guide].                            | Keep explicit capability error/environment contracts. Any erased boundary needs a specific justification, not a general escape hatch.                                 |
| Control flow    | Prefer `const`, early returns, functional array transforms, contextual dot access, and fewer single-use variables.             | Credential uses early returns and `flatMap`; its lock uses a mutable map. Workerd transaction code uses `let` for interruption. [Root style][root-style], [Credential service][credential-service], [workerd adapter][workerd]. | Treat these as readability preferences. Preserve useful domain names, named policy decisions, and explicit control flow; do not mechanically inline or ban loops.     |
| Imports         | No aliases or star imports; use exported domain namespaces; lazy-load heavy branch-specific modules.                           | Schema and Core self-export namespaces, such as `export * as Credential from "./credential.js"`. [Root style][root-style], [schema source][credential-schema].                                                                  | Keep curated local exports. The starter already prohibits self-imports/barrels and has a deliberate `.effects.ts` split. Do not adopt self-export facades by default. |
| Database fields | Use snake_case property keys and implicit SQL column names.                                                                    | Credential's SQL table uses `integration_id` and `text()`; public contracts use `integrationID`, mapped in Core. [SQL table][credential-sql], [Credential service][credential-service].                                         | This trades declaration repetition for mapping work. Retain local naming unless changing the database model for a substantive reason.                                 |
| Formatting      | Prettier, no semicolons, 120-column width.                                                                                     | Root `package.json` declares those options. [Formatting][format].                                                                                                                                                               | Keep Vite+ and local 88-column, single-quote, no-trailing-comma format. Format changes add churn without importing architectural quality.                             |
| Checks          | Root `bun run check`; package-local tests; official TypeScript wins disagreements with `bun check`.                            | Root check runs lint/typecheck; CI substitutes `typecheck:tsc` and additionally checks changed GUI files. [Scripts][scripts], [check workflow][check-workflow].                                                                 | Keep `pnpm run check`/`validate`. A second compiler is an upstream toolchain accommodation, not a quality improvement to copy.                                        |

### Lint policy is less strict than the prose suggests

The root oxlint config turns all built-in categories off. It enables a global Reflect restriction, selected GUI anti-slop rules as warnings, and targeted import restrictions. It does not globally enforce every root style preference. Core's TypeScript config explicitly disables `noUncheckedIndexedAccess`. [Oxlint][oxlint], [Core tsconfig][core-tsconfig].

There is a useful incremental enforcement mechanism: PR CI runs `lint:changed`, which makes every diagnostic fatal for added/edited GUI TypeScript files, including warning-level diagnostics. The script checks whole touched files, not just changed lines, and omits unchanged exact renames. This is stricter than calling the rules “warnings only.” It remains scoped to GUI packages. [Changed-file implementation][lint-changed], [check workflow][check-workflow].

The repository also has ast-grep rules for nested service yields and `JSON.parse(...) as T`, plus tested Effect simplifications. These have different execution paths: `lint:effect-patterns` is a separate script, while Linux unit CI explicitly runs the simplification suite and scan. Root `check` does not itself invoke every named lint script. [Scripts][scripts], [nested-yield rule][nested-yield], [JSON rule][json-rule], [test workflow][test-workflow]. The simplification README explains conservative syntactic matching and known exclusions rather than pretending to have type or binding analysis. [Rule limitations][rule-limitations].

Recommendation: keep the starter's error-level correctness, TypeScript, React, Effect, and anti-slop rules. Borrow the practice of testing lint rules and documenting false-negative limits. A changed-file warning ratchet is useful only if introducing a rule would otherwise require a large cleanup. Do not replace existing full-tree checks with it. Local `packages/oxlint-plugin/AGENTS.md:3-16` already requires syntax-only rules, root-config path gating, concrete diagnostic replacements, and no auto-fixers.

## Backend and Effect patterns

### A useful service example, with failure-policy caveats

`packages/core/src/credential.ts` exposes a documented `Interface`, a `Context.Service` class, a private `Layer.effect`, and named `Effect.fn` methods. Dependencies are acquired at layer construction and implementations capture them. The lock operation documents shared concurrent results, gives its fiber a global scope, and removes pending state with `Effect.ensuring`. [Credential service, lines 39-145][credential-service]. These are strong examples for keeping dependency acquisition out of individual operations and writing down concurrency ownership.

The local capabilities already use `Context.Service`, Seed/Live adapters and composition layers. The improvement to copy is precision in the service contract: whether concurrent callers join, whether failure is shared, who owns cancellation, and when retry becomes possible. Keep these facts near the method or its adjacent intent node. There is no need to import upstream's `makeGlobalNode`/`LayerNode` composition system into `layers.ts`.

Several upstream choices conflict directly with local policy:

- Credential database failures become defects through `Effect.orDie` and `logFailure`. Its public methods therefore omit recoverable database failures from their typed signatures. Local capabilities explicitly require `CapabilityUnavailable` through `orUnavailable`. Preserve that requirement. [Credential service, lines 96-127][credential-service]; local `packages/capabilities/AGENTS.md:55-60`, `lint.config.ts:250` onward.
- Credential `Info` uses `Schema.Class`; the public wire `Entry` uses `Schema.Struct`. This is a purposeful internal/wire distinction upstream, not evidence that classes should replace local structs. Local lint rejects value classes because plain objects cross Worker, queue, and HTTP boundaries. [Credential service, lines 32-37][credential-service], [schema source, lines 61-77][credential-schema]; local `lint.config.ts:213-224`.
- Tool execution guidance routes some user declines through defects so leaf `mapError` does not catch them, then restores typed failures at a later boundary. That is product-specific control flow. Copy its warning that blanket cause-catching can swallow interruption; do not copy defect-based declines into starter authorization. [Tool guide, lines 19-30][tool-guide].

### HTTP contracts and adapter thickness

Credential Protocol declares paths, payloads, success/error schemas, stable operation identifiers, and OpenAPI descriptions. Protocol errors use `Schema.TaggedError` with `httpApiStatus`. Server handlers acquire services and return HTTP values. This fits local `packages/api` and `apps/api` directly and mostly confirms existing choices. [Credential Protocol][credential-protocol], [errors][errors], [handler][credential-handler].

The handler is also a counterexample to perfectly thin adapters: create checks duplicate IDs, consults connect policy, and reconstructs the active credential through ordered list results. The helper knows that the selected credential sorts last. The ordering comment is helpful, but exposing active selection directly from the owner would remove implicit coupling. This is an architectural recommendation, not a demonstrated upstream bug. [Handler, lines 29-44 and 74-83][credential-handler]. Keep starter business decisions in capabilities instead of copying this placement.

Do not copy the credential endpoint's exposure policy. Its documentation explicitly says the list includes secret values. OpenCode's local/developer-server use case differs from a multi-tenant SaaS. [Credential Protocol, lines 8-15][credential-protocol]. Local auth and disclosure rules remain authoritative.

### Runtime portability is explicit, but D1 is different

Current Core has conditional `#sqlite` imports for workerd, Bun and Node. The workerd implementation documents SQLite pragma restrictions, binary normalization, transaction behavior and unsupported streaming. Its structural storage types avoid conflicting host ambient types. [Core exports][core-package], [workerd adapter][workerd]. This is better evidence than assuming all V2 runtime code is Bun-only because the root style guide prefers Bun APIs.

Copy small host-specific adapters and comments that explain a real runtime limitation. Do not copy the storage implementation: it targets Durable Object SQLite, uses `DurableObjectStorage.transaction`, rejects nested transactions, and serializes access with a semaphore. Starter shared persistence is D1, whose atomic writes use `batch`, and its conversation Durable Objects already have a separate owner. [Workerd adapter, lines 57-120][workerd]; local `packages/capabilities/AGENTS.md:59-60`, `ARCHITECTURE.md:63-105,129-134`.

## Schema quality worth copying

The schema guide is the strongest upstream style document in this sample. It defines browser-safe ownership, exact canonical schema identity, readonly public values, stable qualified identifiers, appropriate unknown/JSON boundaries, and optional/default semantics. It distinguishes decode-time convenience defaults from domain construction defaults. [Schema guide][schema-guide].

Actual Credential code follows the same-name value/type pattern, builds a tagged union from variants, and assigns identifiers such as `Credential.OAuth`. `optional` preserves inner transformations while omitting undefined properties when encoding. Contract tests exercise both transformed values and omission, real session wire output, and identifier uniqueness. [Credential schemas][credential-schema], [optional helper][schema-helpers], [contract tests][contract-tests].

Recommended additions to local review criteria:

- Decode and encode are separate contracts. When a schema transforms dates, numbers, or optional fields, verify the wire representation, not only successful decode.
- Preserve one canonical schema value when multiple entrypoints expose it. Do not recreate equivalent-looking schemas for HTTP, MCP, and capability consumers.
- Use domain-qualified public identifiers where generated documentation or clients rely on identity; test collisions at that boundary if the starter generates such output.
- Use JSON-constrained values when the actual contract requires JSON serialization. Opaque `unknown` is appropriate only when another owner will narrow it.

These are targeted improvements, not a reason to copy upstream's schema utility layer wholesale. Its `statics` helper modifies schema properties with `Object.defineProperties` to replace prototype getter behavior. That complexity supports constructors such as `ID.create`; ordinary starter records do not need it. [Schema helpers, lines 26-34][schema-helpers].

Counterexample: the guide says new generated IDs must validate the exact emitted prefix, but current `Credential.ID` brands an unrestricted `Schema.String` and its constructor emits `cred_`. It does not perform prefix validation. This may be legacy tolerance; source alone does not establish when the ID was introduced. It does show why prose cannot substitute for boundary tests. [Schema guide, lines 83-88][schema-guide], [Credential ID, lines 10-15][credential-schema].

## Frontend patterns and React fit

The current app uses Solid, not React. Its workspace controller combines `createStore`, `createMemo`, resources, effects and cleanup. It guards first-load resource reads, retains cached worktrees while refreshing, and verifies the fetched project ID before using the result. The code explains why preserving a selection during loading avoids submitting to the wrong directory. [Controller, lines 63-149][controller].

Copy the behavioral contract: stale data must retain its identity, pending state must not silently change an action's target, and first-load/refresh rendering should be deliberate. Implement it through the starter's TanStack data/loading conventions and React state ownership. Copying `createResource`, stores, Solid accessors, or the general “always prefer createStore” rule would be inappropriate. The upstream controller also suppresses sync failures with `.catch(() => undefined)`; that is not a default for starter mutations or permission-sensitive reads. [Controller, lines 173-195][controller], [app guidance][app-guide].

The Button component is small, defaults to `type="button"`, exposes named size/variant values, and uses native markup with a comment explaining removal of per-instance Kobalte computations. Stories render that same component across variants and sizes. [Button][button], [stories][button-stories]. Borrow explicit component contracts and production-component stories when there is a useful interaction to inspect. Keep the starter's React/shadcn implementation and semantic tokens. Do not copy the large upstream button-variant vocabulary or its CSS naming conventions without a local design need.

App guidance makes typography, font roles, loading-indicator meaning, native scrolling, localization, and Suspense behavior concrete. The useful principle is semantic ownership: tokens describe a role, and a shared component should not be restyled to mean something different at one call site. Some guidance is narrowly product-specific, such as distinguishing AI work from ordinary loading. [Root theme guidance][root-guide], [app guidance, lines 47-105][app-guide], [UI guidance][ui-guide]. Local Paraglide and request-local locale rules should remain; do not import upstream translation functions or its English-only contribution process.

## Tests: the best transferable material

Upstream app guidance asks which observable contract a test protects, which credible regression breaks it, and why existing coverage is insufficient. It assigns one owner per behavior and requires naming retained coverage before deletion. E2E guidance forbids arbitrary sleeps and retries of state-changing actions, requires exact outcome identities, and distinguishes readiness from mere visibility. [App test rules][app-tests], [E2E guide][e2e-guide]. These fit the starter's E2E-first posture and explicit preservation of security, concurrency and Seed/Live contract tests.

Useful inspected examples:

| Example                        | Actual assertion                                                                                                                                                                    | Transfer                                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential refresh concurrency | Two callers receive the same failure; the operation ran once; a later refresh succeeds. Deferred values synchronize execution. [Lock test][lock-test].                              | Use real Effect coordination for concurrency/failure tests that browser E2E cannot reliably control. Avoid sleeping to make a race likely.     |
| Public optional fields         | A numeric-string transform survives optional wrapping; undefined keys disappear on encode; session timestamps encode correctly. [Contract tests, lines 49-85][contract-tests].      | Cover meaningful serialization boundaries, especially queue/HTTP records.                                                                      |
| Session token security         | Expiration, signature tampering, modified timestamp and password rotation all invalidate tokens. [Auth test][auth-test].                                                            | Keep focused security tests even when login E2E exists. Do not substitute this auth implementation for Better Auth.                            |
| Truncated notices              | Real DOM layout must remain one line, clipped and ellipsized at desktop LTR and mobile RTL sizes. [Browser regression][browser-test].                                               | CSS/pixel assertions are justified when rendering is the contract, not as a default for all E2E.                                               |
| Effect test runtime            | TestClock and real-clock modes are distinct; unexpected external HTTP attempts are recorded and fail the test even if product code swallowed the error. [Test helper][test-helper]. | Consider an explicit network refusal boundary in provider-light tests if local coverage lacks one. Preserve actual local D1/queue integration. |

The browser sample is not full-stack evidence: its timeline setup imports `mockOpenCodeServer`. Mocked transport is appropriate for deterministic rendering assertions but does not prove server authorization, persistence or protocol compatibility. Root “avoid mocks” guidance is a preference, not a claim that the upstream test suite has none. [Timeline setup][timeline-setup], [E2E guide, lines 20-24][e2e-guide].

The unit-test skill is unusually useful because it names actual failure mechanisms: clock context lost through bare `Effect.runPromise`, asynchronous sleeps registered after a test advances time, module mocks leaking across files, and unnecessary process startup cost. It also documents exceptions and existing weak tests rather than presenting the codebase as uniformly compliant. Treat its timing numbers as upstream-maintainer observations, not measurements repeated in this audit. [Unit-test guidance][unit-skill].

## Weaknesses and misleading shortcuts

- “Keep things in one function” coexists with support for meaningful single-use helpers. The nuanced extraction rule is better than the slogan. The 1,609-line `git.ts` demonstrates that this style does not inherently produce small modules. Its tail mixes pack-index decoding and path grouping helpers. File size alone proves no defect, but it raises navigation/review costs. [Root style][root-style], [Git tail][git-tail].
- Defect conversion narrows advertised error channels while removing caller recovery choices. Credential is a concrete example. Avoid copying apparently simple `Effect.Effect<A>` signatures without inspecting where failures went. [Credential service][credential-service].
- Documentation and implementation drift exists. Button supports `outline` and `small`; its story variant options omit `outline`, and size controls omit `small` even though the Sizes story renders it. [Button, lines 9-21][button], [stories, lines 42-60 and 94-114][button-stories]. Prefer deriving inspectable choices from the owning contract where practical.
- The V1 isolation test scans top-level `*.ts` and matches one literal import spelling. It is useful scoped regression protection, not comprehensive dependency analysis. Local import restrictions and boundary checks should stay stronger. [V1 test, lines 16-25][v1-tests].
- Root style lists conventional types without `perf`, yet the same guide asks `perf` PRs for visuals and the audited head is a `perf(app)` commit. Copy the starter's configured allowed types rather than another repo's prose list. [Root guide, lines 39-47][root-guide], [commit][commit].
- Root guidance's request to get user buy-in before speculative race/security work should not weaken established starter tenant isolation, audit atomicity, idempotency or recovery rules. Use concrete failure cases to bound scope; existing invariants already justify their implementation. [Root style, line 56][root-style]; local `ARCHITECTURE.md:156-205`.

## Adoption order

| Priority    | Recommendation                                                                     | Local landing point                                                   | Acceptance evidence                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| High        | State boundary decoding once, while retaining authority/invariant rechecks.        | Existing capability/web intent nodes; avoid a duplicate global guide. | A representative input is decoded once and then passed with its inferred type; authorization still runs at the required boundary. |
| High        | Add concurrency and cancellation semantics to methods that coordinate shared work. | Existing service interfaces and adjacent intent nodes.                | Targeted real-layer failure/concurrency coverage where E2E cannot observe ordering reliably.                                      |
| High        | Use the upstream test justification questions and readiness rules.                 | Existing testing guidance and shared E2E helpers.                     | Regression fails before the fix, passes after it, and records the starter-required reproduction artifact.                         |
| Medium      | Verify encode-side contracts and canonical schema reuse.                           | Capability/HTTP contract tests when changing those contracts.         | A real serialization assertion catches a credible wire-shape regression. Avoid testing every trivial struct.                      |
| Medium      | Preserve fetched identity and explicit pending/refresh behavior.                   | React/TanStack loaders and mutation UI.                               | Delayed/out-of-order responses cannot switch the target or reveal another workspace's data.                                       |
| Conditional | Refuse unexpected external network calls in isolated provider tests.               | Existing test runtime, if the parent audit identifies a gap.          | A swallowed HTTP failure still produces a test failure; intended integration traffic remains explicit.                            |
| Conditional | Add narrowly proven lint rules or a warning ratchet.                               | Existing oxlint config/plugin.                                        | Rule fixture shows a real regression and acceptable exceptions; check for an existing plugin rule first.                          |

No recommendation requires Bun adoption, Solid migration, global singleton services, V1 compatibility layers, new runtime schema classes, or a formatter rewrite. Existing starter architecture already implements much of the strongest upstream approach.

## Local source findings and proposed changes

The local inventory counted 714 tracked TS/TSX files under `src`, excluding `.test.`, `.contract.`, `.gen.`, generated directories and declaration files. Of these, 22 exceed 500 lines. This is a navigation inventory, not a complexity score: it includes testing support such as `testing/live-harness.ts`, and declaration-heavy files such as the database schema. The largest implementation candidates include webhook adapters, MCP transport, Stripe integration and billing UI. File length alone does not justify splitting any of them.

The source review sampled the notification contract/adapters and web boundary, workspace suspension contract/policy, billing component declarations, and webhook Live adapter construction. Other files in the inventory were not reviewed line by line. Neither local nor upstream runtime tests were run for this documentation-only audit.

### Make the public operation easier to find

OpenCode's useful rule is to put the main operation before supporting details when that improves reading order. In `packages/capabilities/src/developer-platform/webhook-endpoints.live.ts:60-117`, projection, workspace-filter and metadata helpers precede the exported layer at line 119. Layer-local helpers then occupy more of the reader's path before service operations.

Move independent function declarations below the export when safe. Keep captured dependencies and state in the layer. If a cohesive operation needs extraction, give it an operation-specific module rather than a generic helpers file. The existing `webhook-replay.ts` and `webhook-attempt-history.live.ts` imports already demonstrate the intended direction. Preserve Seed/Live parity, workspace predicates and mutation/audit batching when reorganizing these adapters.

This is a reading-order recommendation, not a request to move every constant below its use. Initialization order still matters.

### Remove repeated explanations of framework mechanics

`apps/web/src/lib/server/notifications.ts:5-12` explains the client-safe split, dynamic import enforcement and schema inference already owned by `apps/web/AGENTS.md:17-18`. `notifications.effects.ts:16-21` repeats the split again. Keep the useful local distinction between the bell's whole-collection read and paged REST/MCP reads; trim the repeated framework tutorial.

`webhook-endpoints.live.ts:95-100` explains both the audit contract and the syntax used to implement it. The contract can be stated directly:

```ts
// Audit only fields supplied by the caller; omit absent fields.
```

Retain the runtime explanation beside `Number(row.delivered)` at lines 75-79. It explains why an apparently redundant conversion is necessary. Also retain comments identifying non-disclosure, cancellation, transaction or provider constraints. Comment reduction should remove repetition, not evidence.

### Shorten local names when context supplies the domain

OpenCode uses module-owned names such as `Credential.CreateInput`. The starter uses explicit named exports such as `SetNotificationPreferenceInput`, and curated subpaths prevent accidental server imports. Preserve those exported contracts. Within `notifications.effects.ts`, the existing `feed` binding is a good example of a short contextual name.

Avoid introducing namespace self-exports just to get shorter identifiers. They conflict with the starter's self-import restrictions. Likewise, `WorkspaceContext as BillingWorkspaceContext` in `webhook-endpoints.live.ts:17` disambiguates a real collision with the capability's own `WorkspaceContext`; a blanket import-alias ban would make this code harder to express.

### Keep policy calculations plain and effects explicit

`workspaceSuspensionOperationForPermission` in `packages/capabilities/src/governance/workspace-suspension.ts:39-61` already follows the transferable style: early refusal, named domain inputs and a synchronous result. `resolvePreferences` in `notifications/notification-preferences.ts:88-99` is another good local exemplar. Neither needs an Effect wrapper.

`notification-preferences.ts:165-175` shares read projection between Seed and Live through a small storage function. This abstraction has actual reuse and keeps default policy in one place. Keep it. A rule that deletes every helper or forces all code into one function would damage this example.

The notification mutation handler also already binds the service before calling it:

```ts
Effect.gen(function* () {
  yield* requireWorkspacePermission({ notification: ['read'] })
  const feed = yield* NotificationFeed
  return yield* feed.markRead(input.ids)
})
```

Use this as a review example. OpenCode's prohibition on nested service yields improves readability without changing our architecture. Before adding a lint rule, test whether the existing Effect plugin reports the undesirable form.

### Simplify the billing component's caller contract

`apps/web/src/components/workspace-billing.tsx` is 814 lines. Its first 202 lines include injectable server-function types, a `BillingPorts` type, the public pricing component, error helpers and the workspace component's large prop declaration. `BillingPlans` still accepts the three ports separately, despite the grouped type's comment describing all ports arriving together.

Review whether callers can supply `ports: BillingPorts` as a complete dependency bundle. That could make preview isolation easier to inspect and reduce repeated declarations. Check all callers and existing coverage before selecting the final API; the declarations alone do not establish a live-port leak. Group billing data only where an existing domain type owns it. Do not hide unrelated props inside a generic `data` bag.

A separate public-pricing module is also a reasonable candidate because its comment explicitly says it has no workspace or recovery state. Judge that split by import dependencies and callers, not the 814-line total. Keep shared plan rendering together where it is actually reused.

### Preserve existing guarantees and tools

The starter already has the key structural practices:

- Schema-derived input types and a single web decode in `notifications.ts:14-39`.
- Explicit service success/failure signatures in `workspace-suspension.ts:79-102`.
- Dependency acquisition at layer construction in `webhook-endpoints.live.ts:130-141`.
- Shared Seed/Live policy in `notification-preferences.ts:88-99,165-175`.
- Error-level `prefer-const`, `no-explicit-any`, exhaustive switches, promise checks and domain restrictions in `lint.config.ts`.

OpenCode's preference for ternaries conflicts with the starter's backend `effect/noTernary` rule. Use early returns there. Its avoidance of destructuring is also a preference, not a reason to rewrite React props or dynamic imports. Preserve explicit public Effect error/environment types even when inference could produce a shorter declaration.

## Suggested first adoption patch

Start with a small readability patch around notifications and webhook helper ordering. It exercises comments, function ordering and Effect flow without requiring a new abstraction. Use the notification preference and suspension functions above as local examples of the desired style.

Proposed review guidance, to incorporate into existing guidance only after adoption is agreed:

- Put the main operation before independent implementation helpers when initialization permits.
- Extract a helper for reuse, a meaningful policy decision or a complex boundary. Keep trivial single-use expressions inline.
- Prefer `const` and early returns. Retain a variable when its name explains a domain decision or prevents repeated work.
- Infer local types; declare public service contracts, including typed failures and dependencies.
- Decode untrusted input at its owner. Recheck current authority and state invariants where required.
- Bind Effect services before invoking methods. Keep pure transformations synchronous.
- Comment on constraints, failure modes and surprising behavior. Remove narration and copies of shared guidance.
- Justify a test with the observable contract and credible regression it catches. Keep focused security, concurrency and wire-contract tests where E2E cannot supply that evidence.

Most of these are review judgments. Keep the current formatter. Do not add name-length limits, blanket `else`/loop/destructuring bans, arbitrary file-size gates or automatic helper extraction. Add a narrow lint rule only after a real example, an existing-rule check and false-positive fixtures establish its value.

After a pilot code change, run the affected checks and `pnpm run check`; use `pnpm run validate` before PR handoff. For any later behavioral refactor, follow the repository's test-first requirement and preserve the relevant Seed/Live, security and audit assertions. The audit itself does not demonstrate that any proposed refactor preserves behavior.

## Pinned primary sources

[commit]: https://github.com/anomalyco/opencode/commit/59e95cc5394b7714451608099ef4db7bffc904b6
[package]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/package.json#L1-L112
[scripts]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/package.json#L9-L36
[format]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/package.json#L143-L146
[contributing]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/CONTRIBUTING.md#L23-L100
[root-guide]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/AGENTS.md#L1-L47
[root-style]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/AGENTS.md#L49-L195
[schema-guide]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/schema/AGENTS.md#L1-L95
[app-guide]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/app/AGENTS.md#L25-L105
[app-tests]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/app/AGENTS.md#L107-L117
[ui-guide]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/ui/AGENTS.md#L1-L21
[tool-guide]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/core/src/tool/AGENTS.md#L1-L55
[oxlint]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/.oxlintrc.json#L1-L175
[core-tsconfig]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/core/tsconfig.json#L1-L18
[lint-changed]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/script/lint-changed.ts#L1-L70
[check-workflow]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/.github/workflows/check.yml#L30-L43
[test-workflow]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/.github/workflows/check-test.yml#L64-L115
[nested-yield]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/script/ast-grep/rules/no-nested-effect-service-yield.yml#L1-L11
[json-rule]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/script/ast-grep/rules/no-json-parse-cast.yml#L1-L6
[rule-limitations]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/script/ast-grep/effect-simplifications/README.md#L1-L17
[credential-service]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/core/src/credential.ts#L1-L298
[credential-schema]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/schema/src/credential.ts#L1-L77
[credential-sql]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/core/src/credential/sql.ts#L1-L14
[credential-protocol]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/protocol/src/groups/credential.ts#L1-L72
[credential-handler]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/server/src/handlers/credential.ts#L1-L84
[errors]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/protocol/src/errors.ts#L5-L81
[schema-helpers]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/schema/src/schema.ts#L1-L41
[core-package]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/core/package.json#L29-L73
[workerd]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/core/src/database/sqlite.workerd.ts#L13-L223
[controller]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/app/src/new-session/workspace/controller.ts#L51-L195
[button]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/ui/src/actions/button/button.tsx#L1-L49
[button-stories]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/ui/src/actions/button/button.stories.tsx#L4-L114
[contract-tests]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/schema/test/contract-hygiene.test.ts#L28-L227
[v1-tests]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/schema/test/v1-isolation.test.ts#L1-L26
[lock-test]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/core/test/credential-lock.test.ts#L1-L41
[auth-test]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/server/test/auth.test.ts#L1-L24
[e2e-guide]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/app/e2e/AGENTS.md#L1-L25
[browser-test]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/app/e2e/regression/session-notice-truncation.spec.ts#L1-L92
[timeline-setup]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/app/e2e/utils/timeline.ts#L1-L19
[test-helper]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/core/test/lib/effect.ts#L10-L80
[unit-skill]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/.opencode/skills/unit-tests/SKILL.md#L32-L119
[git-tail]: https://github.com/anomalyco/opencode/blob/59e95cc5394b7714451608099ef4db7bffc904b6/packages/core/src/git.ts#L1560-L1609
