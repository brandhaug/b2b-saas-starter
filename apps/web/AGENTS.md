# apps/web

## Purpose & Scope

TanStack Start Worker for the public site, auth, workspaces, `/admin` and `/account`. Calls [`capabilities`](../../packages/capabilities/AGENTS.md) in-process, never `apps/api`.

## Entry Points & Contracts

- `src/start.ts` runs the config gate before observability scopes SSR and server-fn calls; nested work joins that scope.
- The Better Auth catchall shares one `AuthExchange` URL parse and session read across rate limit, Turnstile, SSO, impersonation and audit.
- Gates live in `server/auth.ts`: `requireSession` runs once, in the `routes/workspaces.tsx` `beforeLoad`, children read `context.session`, and every server fn calls `requireRequestSession()`.
- `lib/capabilities.ts` maps capability errors to `notFound()` or `capability-error.ts` discriminants. Loaders catch nothing.

## Usage Patterns

- Loader modules use `workspacePage(gate, segment)` to gate reads, resolve `WorkspaceContext` once and wrap secondary permissions in `whenPermitted`. Payload types belong here: segment shape is authorization.
- Server fns dynamically import sibling `.effects.ts` handlers combining session read, permissions and capability call, without an intermediate exported effect. The route tree ships to browsers; `assert-client-boundary.mjs` guards this split.
- Declare one input Effect Schema in the client-safe module. TanStack strips `.validator(Schema.decodeUnknownSync(X))`; tree-shaking removes Schema and `effect`, checked by the bundle guard's Schema markers. `typeof X.Type` types stub and handler; handlers never re-decode.
- Each fn re-reads the session to fail closed independently. N parallel fns cost N+1 reads including the layout gate.
- Component-less API routes (`api.auth.$.ts`) may import `.effects.ts` directly; routes with components may not.
- Organization-plugin mutations pass a `CapabilityBindings` binding per call, never module env.
- The UI gates by permission, never role name (`viewerCan`): an unreadable section is absent, an unpermitted action shows a reason, and the server re-checks.
- Browser decodes stay plain shape probes (`pickOptionalStrings`, `impersonation.ts`); Effect Schema would ship unconditionally.

## Anti-patterns

- Never take identity from a request body: the session is the only identity source, and a headerless plugin endpoint will trust a client-supplied `userId` (#242).
- Never re-gate inside `/workspaces/*`, never add an admin bypass to the workspace guard (no audit trace), never redirect from a server fn.
- No bare client-only imports; they enter the server graph and bloat the Worker upload. Call `createClientOnlyFn(loader)` literally in the component module (ADR 0063), since a shared wrapper defeats the transform.
- No demo-slug fallback: `WorkspaceShell` requires `workspaceSlug` (`null` on `/admin`), and `/demo` is the one workspace whose actorless read is sanctioned.
- Don't sniff error `message` text or use `instanceof` across the SSR boundary; `defaultSerializeError` keeps only `name` and `message`, so match on `name`.
- A parent route with a `component` and no `<Outlet />` swallows its children, hence flat trailing-underscore siblings; only e2e catches it.

## Dependencies & Edges

- Read `cloudflare:workers` bindings, never hardcode empty env. `DB` selects Live, absence Seed; dev uses persisted local D1 (ADR 0049). Browser navigation needs fixture parity (root rule 8).
- Two runtimes. `webRuntime` runs every server-side Effect, with isolate-level `WideEventLoggerLive` and OTLP per invocation (ADR 0050). `authRuntime` holds only `Auth`: merging `AuthLive` in drags the Better Auth server into the browser bundle.
- `lib/rate-limit.ts` trusts only `cf-connecting-ip`; email-OTP, magic-link and reset sends share sign-in's `auth_sign_in` bucket (ADR 0030). Optional providers follow root rule 3.
- Two `RateLimiter` tags (`packages/api`'s and this one) are intentional: the mechanism is single-sourced in `packages/rate-limit`; each owns a distinct bucket vocabulary and gate.

## Patterns & Pitfalls

- Non-disclosure is a rule: constant responses on `/forgot-password`, `disableSignUp` on email-OTP, one opaque failure on `/invitations/accept` and link landings.
- Test loader handlers against Seed without a worker; compare owner `usr_demo` with member `usr_dev`.
- Test server-fn handlers with plain `it`, mocking `./auth` with `fixtureSession(actor)` from `src/test/fixture-session.ts`. Switch fixture identities for authorization checks. Client auth tests use `fakeAuthClient()` from `src/test/fake-auth-client.ts`. Avoid `it.effect`: its epoch-zero `TestClock` makes post-1970 expiry fixtures future-dated.
- `build: { minify: true }` seeds every environment because rolldown-vite's ssr env does not minify by default (#241); a local build understates the upload against the 10 MiB limit.
