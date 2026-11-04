# apps/web

TanStack Start Worker for the public site, auth, workspaces, `/admin` and `/account`. Calls [`capabilities`](../../packages/capabilities/AGENTS.md) in-process, never `apps/api`.

## Contracts

Before changing auth HTTP handling, session reads, workspace authentication gates, anonymous credential flows, or their rate limits, read [web auth guidance](../../docs/agents/web-auth.md).

- `src/start.ts` runs the config gate before observability scopes SSR and server-fn calls; nested work joins that scope.
- Every organization-product path is a `capability-route` refusal: workspace state changes through server functions, which carry authorization, suspension and audit context the plugin's HTTP surface has none of.
- Gates live in `server/auth.ts`: `requireSession` runs once, in the `routes/workspaces.tsx` `beforeLoad`, children read `context.session`, and every server fn calls `requireRequestSession()`.
- `lib/capabilities.ts` maps capability errors to `notFound()` or `capability-error.ts` discriminants. Loaders catch nothing.

## Changes

- Shared UI components own appearance through variants and sizes. Follow [DESIGN.md component ownership](../../DESIGN.md#components) for layout, composition and accessibility exceptions; do not restyle shared internals from consumers or descendant selectors.
- Loader modules use `workspacePage(gate, segment)` to gate reads, resolve `WorkspaceContext` once and wrap secondary permissions in `whenPermitted`. Payload types belong here: segment shape is authorization.
- Server fns dynamically import sibling `.effects.ts` handlers combining session read, permissions and capability call, without an intermediate exported effect. The route tree ships to browsers; TanStack import protection checks the compiled import graph and `assert-client-boundary.mjs` checks built markers independently.
- Declare one input Effect Schema in the client-safe module. Reuse it for browser validation and the server function's `.validator(Schema.decodeUnknownSync(X))`. `typeof X.Type` types stub and handler; handlers never re-decode. Browser validation improves feedback; server validation remains authoritative.
- Component-less API routes (`api.auth.$.ts`) may import `.effects.ts` directly; routes with components may not.
- Organization-plugin mutations pass a `CapabilityBindings` binding per call, never module env.
- The UI gates by permission, never role name (`viewerCan`): an unreadable section is absent, an unpermitted action shows a reason, and the server re-checks.
- Use Effect Schema at browser boundaries, including route search/context, persisted preferences, configuration and serialized errors. Compile reusable decoders at module scope and preserve each boundary's fallback behavior. Effect and Schema may ship to the client; database services, server credentials and capability execution stay server-only, including through shared intermediate modules.
- `scripts/client-import-protection.ts` owns server-only import rules for dev and builds. Add new server execution entrypoints there; preserve shared contracts and the data-only demo identity. Rules follow resolved workspace paths as well as package specifiers. Vitest alone disables them because server-handler tests run in its client environment. `pnpm -C apps/web test:client-boundary` exercises real Start builds and saves per-case logs under `.context/client-boundary` at the repository root.
- A schema exported by a server-only implementation does not make that module client-safe. If a browser consumer needs it, move the shared schema to a client-safe module first; do not exempt the implementation file.

## Boundaries

- Never take identity from a request body: the session is the only identity source, and a headerless plugin endpoint will trust a client-supplied `userId`.
- Never re-gate inside `/workspaces/*`, never add an admin bypass to the workspace guard (no audit trace), never redirect from a server fn.
- No bare client-only imports; they enter the server graph and bloat the Worker upload. Call `createClientOnlyFn(loader)` literally in the component module (ADR 0063), since a shared wrapper defeats the transform.
- No demo-slug fallback: authenticated pages carry the current `workspaceSlug`. `/demo` renders synthetic fixtures under `PreviewProvider`, with isolated queries and local action refusal; preview reads never select Live adapters. The homepage's actorless aggregate stays pinned to the showcase workspace.
- UI errors cross the SSR boundary through `uiErrorAdapter` with allowlisted codes and details. Translate them with `causeMessage`; unexpected exceptions use a safe fallback. Keep diagnostic messages server-side.
- A parent route with a `component` and no `<Outlet />` swallows its children, hence flat trailing-underscore siblings; only e2e catches it.

## Dependencies

- Read `cloudflare:workers` bindings, never hardcode empty env. `DB` selects Live, absence Seed; dev uses persisted local D1 (ADR 0049). Browser navigation depends on the root fixture-parity rule.
- `src/worker.ts` exports the native conversation class for Alchemy development and deployment; `src/server.ts` remains usable by Node SSR. Only the compiled E2E preview uses `scripts/local-worker-runtime.mjs` and its separate Miniflare storage. Alchemy persists development data under `.alchemy/local`.
- Two runtimes. `webRuntime` runs every server-side Effect, with isolate-level `WideEventLoggerLive` and OTLP per invocation (ADR 0050). `authAvailability()` exposes a separate runtime holding only `Auth` when D1 exists: merging the Auth layer in drags the Better Auth server into the browser bundle.

## Pitfalls

- Locale resolution must run inside the request observability scope before rendering. Use request-scoped runtime messages, never cache translated copy at module scope. Public URLs carry locales; app/auth paths use account preferences or the guest cookie (ADR 0029). See [i18n contribution rules](../../docs/i18n.md) when adding copy, formats, or content.

- Non-disclosure is a rule: constant responses on `/forgot-password`, `disableSignUp` on email-OTP, one opaque failure on `/invitations/accept` and link landings.
- When isolation is necessary under the [root testing policy](../../AGENTS.md#testing), use `fixtureSession(actor)` for server-fn authorization and `fakeAuthClient()` for client auth. Use plain `it`: `it.effect` uses an epoch-zero `TestClock`, making post-1970 expiry fixtures future-dated.
