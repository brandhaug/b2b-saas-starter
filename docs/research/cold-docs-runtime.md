# Cold docs runtime checks

## Failure scenarios recorded before implementation

- Overlapping first docs requests in one fresh workerd isolate could share pending
  request-owned I/O, fail with a cross-request ownership error, or hang. Exercise
  concurrent cold metadata/article loads with bounded requests and inspect results.
- A rejected first metadata load could remain cached and poison later requests.
  Exercise failure then recovery at a controlled metadata-loading boundary if the
  existing runtime harness can reach it without adding a production fault endpoint.
- Concurrent requests for different locales could leak navigation locale or article
  selection. Check each response against its own locale, including warm follow-ups.
- A cache repair could eagerly import MDX into the browser or move metadata
  enumeration client-side. Preserve lazy component loading and verify bundle checks.

## Scope

The approved audit recommendation is the specification; no issue number was supplied.
Upstream reference baseline: `51964a1fa52bed2a4a36defabad1ee17d360fe23`.
Local workerd evidence does not establish deployed behavior. Immutable components,
completed metadata values, and pending request-owned operations must be assessed
separately before changing cache ownership.

## Execution paths and change

`_knowledge.tsx` and the article route call `getAllDocMeta`. On SSR, TanStack
invokes the server handler in-process. Browser navigation uses its HTTP server
function stub. `docs.effects.ts` enumerates compiled MDX imports, not a remote
asset store. The browser receives frontmatter only. Article components retain
their lazy, per-path React component cache, and translated navigation is computed
in the request locale.

`getAllDocMeta` now retains only successfully completed frontmatter. Concurrent
cold callers may enumerate the same immutable modules independently. A rejection
does not fill or clear the completed cache. This fixes rejection retention without
changing component identity or moving metadata enumeration into the browser.

The ordinary E2E preview renders SSR in Node and uses workerd for D1 and conversation
storage. The dedicated docs runtime build instead bundles the actual Worker entry,
TanStack routes and MDX for Miniflare's workerd. It uses the repo compatibility
date and flags, with provider bindings absent. Its test-only module resolution
wraps metadata enumeration in an optional service-binding gate. The unbound test
uses real compiled imports; the bound tests hold concurrent calls or reject loads
before delegating to the same enumeration. This gate never enters ordinary builds.

## Repeatable evidence

```sh
vp install
pnpm -C apps/web run test:docs-runtime
```

Each test creates and disposes a fresh workerd runtime. No readiness HTTP request
warms docs. Requests have a 15-second abort signal; each test has a 30-second limit.
The overlap gate requires both English and Norwegian requests to arrive before
either is released. Responses assert status, HTML language, article title, docs
links and the correct translated category label, rejecting the other locale's
label. The recovery test checks an initial 500, a subsequent successful load in
the same isolate, and reuse without another boundary call.

Observed locally on 2026-10-25 with the pinned lockfile:

- Before the cache fix, the unbound cold-load test passed. The gated overlap test
  saw only one request reach the boundary; recovery returned 500 instead of 200.
- After the cache fix, all three native runtime tests passed.
- These are controlled local checks. The injected service binding demonstrates
  pending-work ownership and rejection recovery, not a remote-I/O bug in compiled
  MDX imports or a guarantee about deployed isolates.

The suite runs in the web `test` script, including root `check` and `validate`.
The normal build also runs `scripts/assert-client-boundary.mjs`.
