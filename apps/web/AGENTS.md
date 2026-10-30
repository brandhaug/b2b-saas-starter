# apps/web

Foldkit Worker for the public site, auth, workspaces, `/admin` and `/account`. Calls [`capabilities`](../../packages/capabilities/AGENTS.md) in-process, never `apps/api`.

## Contracts

Before changing auth HTTP handling, session reads, workspace authentication gates, anonymous credential flows, or their rate limits, read [web auth guidance](../../docs/agents/web-auth.md).

- `src/start.ts` runs the config gate before observability scopes SSR and HTTP calls; nested work joins that scope.
- Every organization-product path is a `capability-route` refusal: workspace changes use application HTTP handlers carrying authorization, suspension and audit context.
- `src/http/page-loader.ts` applies page gates through `lib/server/auth.ts`. HTTP operations independently call `requireRequestSession()`; browser state never grants authority.
- `lib/capabilities.ts` maps capability errors to safe UI discriminants. `http/errors.ts` limits HTTP failures to public codes and details. Keep diagnostic messages server-side.

## Changes

- Loader modules use `workspacePage(gate, segment)` to gate reads, resolve `WorkspaceContext` once and wrap secondary permissions in `whenPermitted`. Payload types belong here: segment shape is authorization.
- Client-safe modules declare Effect HttpApi contracts and input schemas. `src/http` assembles sibling `.effects.ts` handlers on the server; `scripts/browser-boundary.ts` rejects server implementation imports in client bundles.
- Effect schemas intentionally ship with native Foldkit models/messages and HTTP clients. HTTP decoding happens at the contract boundary; handlers do not re-decode.
- Native UI lives in `src/foldkit`: pure updates return models and commands; subscriptions and managed resources own timers, sockets, dialogs and cleanup. Lift child resources as well as messages into the root program.
- Organization-plugin mutations pass a `CapabilityBindings` binding per call, never module env.
- The UI gates by permission, never role name (`viewerCan`): an unreadable section is absent, an unpermitted action shows a reason, and the server re-checks.
- Preserve exact Foldkit pins. SSR upgrades require compiled-host and browser checks for statuses, cookies, hydration and asset misses.

## Boundaries

- Never take identity from a request body: the session is the only identity source, and a headerless plugin endpoint will trust a client-supplied `userId`.
- Resolve the workspace gate once per page load; HTTP calls recheck authority. Never add a System Admin bypass or redirect from an operation handler.
- Keep browser boot separate from the server program. Browser APIs execute only in commands/resources after hydration, never during SSR initialization.
- No demo-slug fallback: authenticated pages carry `workspaceSlug`. `/demo` uses synthetic flags and local refusal; preview reads never select Live adapters. The homepage aggregate stays pinned to the showcase workspace.
- UI errors cross the SSR boundary through `uiErrorAdapter` with allowlisted codes and details. Translate them with `causeMessage`; unexpected exceptions use a safe fallback. Keep diagnostic messages server-side.
- `worker.ts` dispatches `/api`, `/.well-known` and `/ready` before Foldkit HTML negotiation. Dev/preview must preserve that split. Client assets come from `dist/client`, not the server output directory.

## Dependencies

- Read `cloudflare:workers` bindings, never hardcode empty env. `DB` selects Live, absence Seed; dev uses persisted local D1 (ADR 0049). Browser navigation depends on the root fixture-parity rule.
- `src/worker.ts` wraps Foldkit fetch and exports the native conversation class; `src/server.ts` remains usable by Node SSR. Dev/E2E load `scripts/local-worker-runtime.mjs` outside Vite to share persisted D1 and conversation storage. Restart dev after native host edits.
- Two runtimes. `webRuntime` runs every server-side Effect, with isolate-level `WideEventLoggerLive` and OTLP per invocation (ADR 0050). `authAvailability()` exposes a separate runtime holding only `Auth` when D1 exists: merging the Auth layer in drags the Better Auth server into the browser bundle.

## Pitfalls

- Locale resolution must run inside the request observability scope before rendering. Use request-scoped runtime messages, never cache translated copy at module scope. Public URLs carry locales; app/auth paths use account preferences or the guest cookie (ADR 0029). See [i18n contribution rules](../../docs/i18n.md) when adding copy, formats, or content.

- Non-disclosure is a rule: constant responses on `/forgot-password`, `disableSignUp` on email-OTP, one opaque failure on `/invitations/accept` and link landings.
- When isolation is necessary under the [root testing policy](../../AGENTS.md#testing), use `fixtureSession(actor)` for server-fn authorization and `fakeAuthClient()` for client auth. Use plain `it`: `it.effect` uses an epoch-zero `TestClock`, making post-1970 expiry fixtures future-dated.
