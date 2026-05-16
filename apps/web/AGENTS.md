# apps/web

TanStack Start web app served by a Cloudflare Worker (`vite.config.ts` uses the `cloudflare:workers` shim). Dev server runs on `:3071`. Owns the public showcase, knowledge content, auth screens, the seed-backed workspace reference app, admin dashboard, Storybook, Vitest (unit), and Playwright (e2e).

## Routes

- `/` — interactive architecture showcase, capability-backed against the `starter-lab` seed workspace.
- `/docs`, `/blog`, `/faq`, `/help`, `/changelog` — checked-in MDX/JSON knowledge content.
- `/pricing`, `/privacy`, `/terms` — standard B2B SaaS surfaces adapted for the starter.
- `/sign-in` — email/password via Better Auth; GitHub OAuth button is intentionally `disabled` until secrets are configured.
- `/workspaces`, `/workspaces/$workspaceSlug`, `/workspaces/$workspaceSlug/settings` — reference app hardcoded to the `starter-lab` seed workspace.
- `/admin` — Better Auth admin plugin dashboard. **No impersonation UI on purpose** — out of scope for the starter.
- `/api/auth/$` — Better Auth catchall handler.

## Data fetching

- Route loaders use `runCapabilities(Effect.gen(function* () { … }))` to call `@b2b-saas-starter/capabilities` directly. **There are no REST round-trips from this app to `apps/api`** — `apps/api` is the _external_ surface.
- Mutations use TanStack Start server functions (e.g. `createApiTokenServerFn`) that wrap a capability call.
- Effect Atom for client server-state is **not wired** today; loaders + server functions are sufficient. Revisit once a route needs subscribe/optimistic semantics.

## Auth

- `auth-client.ts` composes Better Auth `adminClient()` + `usernameClient()` plugins. Routes that need a session call `authClient.useSession()`.
- Search-param schemas validate inputs with `effect/Schema` (see `sign-in.tsx`).

## Patterns

- Use shadcn/ui primitives from `src/components/ui` — don't ship one-off primitives.
- Use semantic Tailwind tokens, not raw one-off colors.
- Use TanStack Form for meaningful mutation forms (`sign-in.tsx`, `api-token-form.tsx` are the canonical references).
- Keep full workspace-data search out of the first search index; search public content + command actions first.

## Testing

- Vitest for unit tests co-located with components (`*.test.tsx`).
- Playwright e2e in `e2e/` driven by `playwright.config.ts`. Use the same dev server, not a built artefact.
- Storybook config at `.storybook/`, stories co-located (`*.stories.tsx`). Follow the storybook skill for new stories.
