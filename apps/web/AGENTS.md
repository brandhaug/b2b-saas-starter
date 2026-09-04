# apps/web

## Purpose & Scope

TanStack Start app on a Cloudflare Worker. Owns the public showcase, the auth screens, the workspace reference app, `/admin` and `/account`. It never calls `apps/api`, only [`capabilities`](../../packages/capabilities/AGENTS.md) in-process.

## Entry Points & Contracts

- `src/start.ts` registers the config gate before the observability middleware scoping every SSR render and server-fn call; that order is load-bearing, and nested work joins that scope.
- The Better Auth catchall parses the URL once into an `AuthExchange` shared by rate limit, Turnstile, the SSO gate, the impersonation guard and the audit recorder (one `ExchangeRow` per endpoint), on one session read.
- Gates live in `server/auth.ts`: `requireSession` runs once, in the `routes/workspaces.tsx` `beforeLoad`, children read `context.session`, and every server fn calls `requireRequestSession()`, which fails rather than redirecting.
- `lib/capabilities.ts` maps capability errors to `notFound()` or `capability-error.ts` discriminants. Loaders catch nothing.

## Usage Patterns

- Loader modules, not inline loaders. `workspacePage(gate, segment)` hard-gates the read permission, resolves `WorkspaceContext` once and wraps a second permission in `whenPermitted`. Payload types belong here, not in `capabilities`: segment shape is an authorization call.
- A server fn holds the gate; its behavior is an exported effect in a sibling `.effects.ts`, reached by dynamic `import()` because the route tree ships to the browser (`assert-client-boundary.mjs` checks this). Input constraints live in its schema.
- Organization-plugin mutations pass a `CapabilityBindings` binding per call, never module env.
- The UI gates by permission, never role name (`viewerCan`): an unreadable section is absent, an unpermitted action shows a reason, and the server re-checks.
- Auth-flow routes validate search params with `pickOptionalStrings`; `effect/Schema` there would pin the Effect runtime onto pages that run no capability.

## Anti-patterns

- Never take identity from a request body: the session is the only identity source, and a headerless plugin endpoint will trust a client-supplied `userId` (#242).
- Never re-gate inside `/workspaces/*`, never add an admin bypass to the workspace guard (no audit trace), never redirect from a server fn.
- No bare client-only imports; they enter the server graph and bloat the Worker upload. Call `createClientOnlyFn(loader)` literally in the component module (ADR 0063), since a shared wrapper defeats the transform.
- No demo-slug fallback: `WorkspaceShell` requires `workspaceSlug` (`null` on `/admin`), and `/demo` is the one workspace whose actorless read is sanctioned.
- Don't sniff error `message` text or use `instanceof` across the SSR boundary; `defaultSerializeError` keeps only `name` and `message`, so match on `name`.
- A parent route with a `component` and no `<Outlet />` swallows its children, hence flat trailing-underscore siblings; only e2e catches it.

## Dependencies & Edges

- Bindings come from `cloudflare:workers`: a real `DB` activates Live, its absence Seed, and an empty env must never be hardcoded (`vite dev` aliases a shim with persisted local D1, ADR 0049). Client navigations rerun loaders in the browser against Seed, so fixture parity is load-bearing.
- Two runtimes. `webRuntime` runs every server-side Effect, with isolate-level `WideEventLoggerLive` and OTLP per invocation (ADR 0050). `authRuntime` holds only `Auth`: merging `AuthLive` in drags the Better Auth server into the browser bundle.
- Optional providers stay absent until configured: Turnstile (ADR 0031), social (ADR 0070), Stripe (ADR 0060), OTLP, MCP OAuth (ADR 0068). `lib/rate-limit.ts` trusts only `cf-connecting-ip`; email-OTP and magic-link sends share sign-in's `auth_sign_in` bucket (ADR 0030).

## Patterns & Pitfalls

- Non-disclosure is a rule: constant responses on `/forgot-password`, `disableSignUp` on email-OTP, one opaque failure on `/invitations/accept` and link landings.
- Loaders run without a worker against Seed: call them directly and assert the payload. `usr_demo` owns the seed workspace, `usr_dev` is a plain member, enabling owner/member comparison.
- Test a server fn as its exported effect with plain `it`, not `it.effect`: its `TestClock` starts at epoch 0, putting a post-1970 expiry fixture in the future.
- `build: { minify: true }` seeds every environment because rolldown-vite's ssr env does not minify by default (#241); a local build understates the upload against the 10 MiB limit.
