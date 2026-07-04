# apps/web

TanStack Start web app served by a Cloudflare Worker (`vite.config.ts` uses the `cloudflare:workers` shim). Dev server runs on `:3071`. Owns the public showcase, knowledge content, auth screens, the seed-backed workspace reference app, admin dashboard, Storybook, Vitest (unit), and Playwright (e2e).

## Routes

- `/` — interactive architecture showcase, capability-backed against the `starter-lab` seed workspace.
- `/docs`, `/blog`, `/faq`, `/help`, `/changelog` — checked-in MDX/JSON knowledge content.
- `/pricing`, `/privacy`, `/terms` — standard B2B SaaS surfaces adapted for the starter.
- `/sign-in` — email/password via Better Auth; GitHub OAuth button is intentionally `disabled` until secrets are configured.
- `/workspaces`, `/workspaces/$workspaceSlug`, `/workspaces/$workspaceSlug/settings` — reference app; the index lists the user's memberships via the `listWorkspacesForUser` projection (possibly empty — empty state, never a 404), nav and palette thread the current slug (`src/routes/workspaces.tsx` is the subtree's auth-gate layout route).
- `/admin` — Better Auth admin plugin dashboard, gated by `requireAdmin` (admin role required; non-admins 404). System-level reads only: users via the admin plugin's `listUsers` (`src/lib/server/admin.ts`), audit events via `runCapabilities` + `AuditEventLog.listGlobal` — it never borrows a workspace, so the shell renders with `workspaceSlug={null}` and no unread badge. **No impersonation UI on purpose** — out of scope for the starter.
- `/api/auth/$` — Better Auth catchall handler.

## Data fetching

- Route loaders use `runWorkspaceCapabilities(slug, effect, actor)` (`src/lib/capabilities.ts`) to call `@b2b-saas-starter/capabilities` directly. Reads that are not scoped to one workspace (the `/workspaces` index projection, `/admin`'s global audit log) use `runCapabilities(effect)` from the same file — it provides the capability services without `WorkspaceContext`. **There are no REST round-trips from this app to `apps/api`** — `apps/api` is the _external_ surface.
- Prefer the named read projections from the capabilities package over hand-composed `Effect.gen` loaders: the dashboard loads `workspaceDashboard` and settings loads `workspaceSettingsSummary`, which ship pre-computed aggregates (readiness score, unread count, module-status tallies). Components render those values — don't re-derive them in `useMemo` (see `ModuleStatusChart`, which takes `data` from the projection).
- `src/lib/capabilities.ts` reads bindings from `cloudflare:workers` (same as `server-context.ts`): with a real `DB` binding the Live D1 layer activates; without one the in-memory Seed layer keeps the app provider-light. Never hardcode an empty env. `vite dev` aliases to `cloudflare-workers-shim-dev.ts`, which attaches the persisted local D1 (`packages/db/.wrangler`, from `db:migrate:local` + `db:seed`) via wrangler's `getPlatformProxy` when it exists — so credential sign-in and Live layers work locally (ADR 0049). Test and build keep the inert `cloudflare-workers-shim.ts` (`DB: undefined`); the dev shim's Node imports stay behind `import.meta.env.SSR` because dev serves it to the browser too. Client-side navigations run loaders in the browser against the Seed layer regardless, so Seed/Live fixture equivalence (demo user membership included) is load-bearing.
- The same file computes `StarterEnv.moduleConfig` via `makeStarterEnvModuleConfig(env)` from `@b2b-saas-starter/env` (ADR 0035). The capabilities layer overlays those env-derived statuses onto `StarterModuleCatalog` and `IntegrationSurfaces`, so module/integration status in the workspace UI reflects the worker's real env — a module with unset vars shows `needs-config` with the missing var _names_ (never values), regardless of stored fixture state.
- Mutations use TanStack Start server functions (e.g. `createApiTokenServerFn`) that wrap a capability call. Server-fn inputs are validated by `effect/Schema` **with all constraints in the schema** (no imperative re-validation).
- Effect Atom for client server-state is **not wired** today; loaders + server functions are sufficient. Revisit once a route needs subscribe/optimistic semantics.

## Auth

- Server gates live in `src/lib/server/auth.ts`:
  - `requireSession(redirectTo)` — redirects anonymous visitors to `/sign-in` (preserving `?redirect=`) and returns the session. It runs ONCE in the `/workspaces` layout route's `beforeLoad` (`src/routes/workspaces.tsx`); child routes read `context.session` instead of re-gating. Don't copy the gate into new `/workspaces/*` routes.
  - `requireAdmin(redirectTo)` for `/admin` — additionally checks the Better Auth admin role (`user.role === 'admin'`); non-admins get a 404 (non-disclosing). `/admin` keeps its own `beforeLoad` gate.
  - `requireRequestSession()` inside **every** workspace-data server-function handler. On session expiry it fails with the typed `UnauthorizedError` (message displayed by the calling form) — never a redirect; redirects belong to navigation gates only.
- Workspace loaders and server functions must pass the actor (`{ userId: session.user.id }`) to `runWorkspaceCapabilities`; the capabilities layer enforces workspace membership and non-members get `WorkspaceNotFound`. Only trusted public-showcase reads (`/` homepage) omit the actor.
- `auth-client.ts` composes Better Auth `adminClient()` + `usernameClient()` plugins. Client components that need a session call `authClient.useSession()`; `WorkspaceShell` renders a sign-out button via `authClient.signOut()`.
- Search-param schemas validate inputs with `effect/Schema` (see `sign-in.tsx`).
- Seeded demo credentials for a local D1 live in `src/lib/demo-workspace.ts` and docs/setup.md (`demo@starter.local`).
- Auth rate limiting — `src/lib/rate-limit.ts` is a thin config shim over `@b2b-saas-starter/rate-limit`; the fallback store is module-scope in the package, so `api.auth.$.ts` rebuilding the layer per request is safe; `clientKey` trusts only `cf-connecting-ip` (no `x-forwarded-for`, even in dev).

## Error handling

- `runWorkspaceCapabilities`/`runCapabilities` map typed capability failures: `WorkspaceNotFound` → TanStack `notFound()` (404 page), `CapabilityUnavailable` → `CapabilityUnavailableError`, rendered by `router.tsx`'s `defaultErrorComponent` as a friendly degraded-state notice (CLAUDE.md rule 3). Loaders don't catch anything themselves.
- The degraded-state discriminant is `CAPABILITY_UNAVAILABLE_ERROR_NAME` in `src/lib/capability-error.ts` — a client-safe module (no `cloudflare:workers` import) single-sourcing the error's `name` and the router's check. Loader errors cross the SSR boundary through `defaultSerializeError`, which keeps only `name`/`message` — never sniff message text or use `instanceof`.
- Capability-backed routes set `pendingComponent: RoutePending` (`src/components/route-pending.tsx`).
- The demo-workspace slug constant lives in `src/lib/demo-workspace.ts`; workspace UI (shell nav, command palette) threads the current `$workspaceSlug` — there is no demo-slug fallback anywhere: `WorkspaceShell` requires `workspaceSlug` (`null` on system surfaces like `/admin`), and the palette falls back to the `/workspaces` list.

## Patterns

- Use shadcn/ui primitives from `src/components/ui` — don't ship one-off primitives.
- Use semantic Tailwind tokens, not raw one-off colors.
- Use TanStack Form for meaningful mutation forms (`sign-in.tsx`, `api-token-form.tsx` are the canonical references).
- Keep full workspace-data search out of the first search index; search public content + command actions first.

## Testing

- Vitest for unit tests co-located with components (`*.test.tsx`).
- Playwright e2e in `e2e/` driven by `playwright.config.ts`. Use the same dev server, not a built artefact.
- Storybook config at `.storybook/`, stories co-located (`*.stories.tsx`). Follow the storybook skill for new stories.
