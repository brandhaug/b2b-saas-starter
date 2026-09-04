# @b2b-saas-starter/auth

## Purpose & Scope

The Better Auth instance and nothing else. This package owns the options object, the plugin list, and the plugin↔schema mapping. It holds no route handlers, no session gates, and no permission decisions.

Two runtime exports carry everything:

- `Auth` — an `effectful-better-auth` service providing `{ api, instance }`. `api` is the effectful endpoint proxy (endpoints fail `BetterAuthApiError`); `instance` is the raw Better Auth object for `handler` / `asResponse` needs. The layer requires `AuthConfig`.
- `AuthConfig` — `{ db, secret, baseURL, trustedOrigins, emails, socialProviders, accountHooks, requireEmailVerification, runBackground }`. The app builds it from worker env (`apps/web/src/lib/auth-runtime.ts`); this package never reads `process.env` or a Cloudflare binding. `emails` is the `AuthEmailSender` port and `accountHooks` the `AuthAccountHooks` port (below); `socialProviders` carries the resolved active providers (`activeSocialProviders` in `@b2b-saas-starter/env`, structural local type here so this package does not depend on env); `runBackground` **is required** and becomes Better Auth's `advanced.backgroundTasks.handler` verbatim — `ctx.waitUntil` on a Worker that exposes an execution context, and an explicit inline runner where the host does not. There is no fallback here on purpose: a swallow-everything default would make "the verification email vanished past the response" this package's silent decision instead of the app's stated one, and whatever the app supplies owns the rejection.

`Session` and `SessionUserRole` are the inferred session types. `SessionUserRole` exists as a **compile-time guard**: widening the plugin array drops every plugin-added field from `Session` while the endpoints keep working, a break no runtime test can see because the data is still there. Indexing the type is the assertion.

## Account lifecycle emails

Password reset and email verification are configured here and sent through the `AuthEmailSender` port — `{ sendResetPassword, sendVerificationEmail }`, whose members carry **Better Auth's own callback signature** (`({ user: { email }, url }) => Promise<void>`, narrowed to the two fields the starter reads) and whose names are Better Auth's option names. That is deliberate: the adapter is assigned straight to `emailAndPassword.sendResetPassword` and `emailVerification.sendVerificationEmail`, so there is no rename wrapper and no `async` callback in this package to disable a lint rule for. Better Auth invokes its callbacks outside any Effect (no Clock, no services), and the siblings rule forbids importing `packages/email` from here, so the port carries both constraints. The app supplies the adapter (`apps/web/src/lib/server/auth-emails.ts`), built on the `EmailDispatcher` with its log-mode fallback.

Configuration decisions, stated in code:

- `sendOnSignUp: true` — the verification email rides sign-up; there is no UI reason to demand a second hop.
- `autoSignInAfterVerification: true` — the link clicker gets a session: proving mailbox control is the honest reward, not an escalation.
- `revokeSessionsOnPasswordReset: true` — the sessions that preceded a reset are exactly what the reset exists to distrust.
- `requireEmailVerification` is **env-gated**: on only when `ENVIRONMENT=production` (decided by `requireEmailVerification` in `@b2b-saas-starter/env`, carried on `AuthConfig` — this package never reads env). Local dev sends to the log, where nobody could read a gating email; the unverified state surfaces as an app banner instead.

## Position in the dependency graph

`auth` and [`capabilities`](../capabilities/AGENTS.md) are **siblings**. Neither imports the other, and the rule holds in both directions: a capability that needs the plugin's write path declares a structural port and the app supplies the adapter (ADR 0051). Both import [`authz`](../authz/AGENTS.md), which sits below them.

`db` is imported twice on purpose: `@b2b-saas-starter/db/client` for the **promise-based** drizzle client, which is the only thing Better Auth's `drizzleAdapter` accepts, and `@b2b-saas-starter/db/schema` for the model mapping. Mind the name collision — `db/client` exports a _type_ `Database` (the promise client this package uses) and `db/service` exports a _class_ `Database` (the Effect-native service every capability's Live layer depends on). This package wants the former.

## Plugins

Order matters. `tanstackStartCookies()` must stay **last** so cookies set by other plugins' hooks reach the framework cookie store.

| Plugin                                                                          | Why                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `username()`                                                                    | username sign-in alongside the Local Auth Path                                                                                                                                                                                                                                                                                                            |
| `twoFactor({ ... })`                                                            | TOTP only, verified before it counts as on; backup codes at enrollment                                                                                                                                                                                                                                                                                    |
| `passkey({ ... })`                                                              | WebAuthn passkeys (ADR 0056): `rpID`/`origin` derive from `baseURL`, so localhost works with zero env; registration demands a session, sign-in opens one directly                                                                                                                                                                                         |
| `admin({ adminRoles, impersonationSessionDuration, allowImpersonatingAdmins })` | System Admin axis — `user.role`, ban/unban, impersonation (ADR 0054), `listUsers` for `/admin`. `adminRoles` reads `adminSystemRole` from `@b2b-saas-starter/db/enums`, never a restated `'admin'` literal. Impersonation is one hour (the capability's `IMPERSONATION_SESSION_SECONDS` restates the number — siblings) and admins are never impersonable |
| `organization({ ... })`                                                         | Workspace membership and invitations (ADR 0051)                                                                                                                                                                                                                                                                                                           |
| `lastLoginMethod()`                                                             | the "last signed in with X" hint — cookie-backed (`storeInDatabase` off: no user column, no migration); imported from the `better-auth/plugins` barrel, which 1.7 exposes no dedicated subpath for                                                                                                                                                        |
| `tanstackStartCookies()`                                                        | bridges the session cookie into TanStack Start; **last**                                                                                                                                                                                                                                                                                                  |

Social providers are **absent until configured** (ADR 0057): `AuthConfig.socialProviders` carries only the providers the app resolved as active (both client halves present); with none configured it carries an empty object, which resolves to zero providers inside Better Auth — no provider exists at all, nothing exists-but-disabled, and the Local Auth Path's runtime shape is unchanged. A fork adds a provider by adding the env vars plus a resolver entry in `activeSocialProviders` (`@b2b-saas-starter/env`), never by wiring a provider that exists but is disabled.

`databaseHooks.account.create.after` / `delete.after` are wired to the `AuthAccountHooks` port (`onAccountLinked` / `onAccountUnlinked`), the same structural-port pattern as `AuthEmailSender`: Better Auth calls its hooks outside any Effect with the full account row, the port narrows it to `{ providerId, userId }`, and the app's adapter (`apps/web/src/lib/server/social-account-audit.ts`) records the `auth.account_linked` / `auth.account_unlinked` audit events — it filters `credential` rows, which already have their own lifecycle row.

The array goes through `plugins(...)` from `effectful-better-auth`, and `makeAuthOptions` returns a single non-union object type. A bare array literal in a function body widens to a union array and silently drops plugin schema inference — `SessionUserRole` is what catches that.

## Passkeys (ADR 0056)

The plugin's `rpID` and `origin` are **derived, never configured separately**: `passkeyRpID(baseURL)` returns the URL's hostname and `passkeyOrigin(baseURL)` its origin — both module-private, each with a single call site in the options object, and covered through the composed options in `options.test.ts`. `localhost` is a valid WebAuthn rpID, so the Local Auth Path gains passkeys with zero configuration — passkeys are not an Optional Provider and get no env gate. A fork serving several origins widens `origin` to the plugin's array form.

**A passkey sign-in satisfies the two-factor requirement.** The two-factor plugin's gate is an after-hook matching the credential sign-in endpoints only; the passkey plugin's verification endpoint creates its session directly, so a TOTP-enabled user signs in with a passkey and lands in the app with no code hop. The ceremony is two factors in one gesture (credential possession + authenticator user verification, requested as `preferred`). This is pinned in `src/live-passkey.test.ts`, which runs a full mocked WebAuthn ceremony (a software ES256 authenticator: minimal CBOR, `none`-format attestation, DER-wrapped signatures) against a real local D1 — the same harness the plugin's table mapping and management endpoints are tested through.

## The organization plugin's mapping

The starter's domain word is **Workspace** and the plugin's is "organization". The mapping lives here and nowhere else:

- `schema.organization.modelName = 'workspaces'`, `member → 'workspaceMembers'`, `invitation → 'workspaceInvitations'`. `modelName` is the **drizzle schema export key**, not the SQL table name — the adapter resolves models with `schema[modelName]`.
- `member` and `invitation` each carry `fields: { organizationId: 'workspaceId' }`. That is the only rename needed; every other plugin field name already matches a real column, because [`packages/db`](../db/AGENTS.md) gave those three tables the plugin's camelCase shape.
- `additionalFields` on `organization`: `planId`, which is the starter's own and part of the public `Workspace` DTO, and `updatedAt`, which the plugin's organization model does not declare. Both are `input: false` — a plan change is billing's job, not a caller's. Neither belongs in `metadata`: the plugin strips unknown columns from endpoint responses, and it stringifies `metadata` itself.
- `ac: accessControl` and `roles: workspaceRoleAccess` come from [`authz`](../authz/AGENTS.md). The plugin's own endpoints and `requirePermission` read the same objects, so they cannot disagree.
- `teams: { enabled: false }`, stated rather than defaulted. `dynamicAccessControl` is absent for the same reason: both want tables the schema does not have.

## Invariants

1. **A new column on `workspaces`, `workspace_members`, or `workspace_invitations` needs an `additionalFields` entry here.** A column the plugin does not know about is stripped from every endpoint response — the write succeeds and the read comes back missing the field.
2. **Nothing reads `session.activeOrganizationId`.** The plugin declares it unconditionally and writes it on create, accept, and set-active; no option turns it off, so the column exists and `live-d1.test.ts` asserts it does. The starter resolves the workspace from the request slug through `liveWorkspaceContext`, and the slug wins because it is what the address bar shows. Two sources of truth for "which workspace" is how a user ends up looking at one workspace's URL and another's data.
3. **Roles stay static and single.** The plugin's `parseRoles` joins multiple roles into one comma-separated string in `workspace_members.role`, which the column's `enum: workspaceRoles` type does not admit. Assigning two roles would write `"admin,member"`.
4. **`new Date()` in the `additionalFields` callbacks is deliberate.** Better Auth calls them outside any Effect, so `Clock` cannot reach them; this file is the platform adapter the `effect/noGlobals` rule exempts. Without `onUpdate` the column keeps its insert value forever.

## Anti-patterns

- Don't import `@b2b-saas-starter/capabilities` from here, and don't import this package from there. Use a structural port (ADR 0051).
- Don't put a permission check here. Statements, roles, and the guard live in [`authz`](../authz/AGENTS.md); enforcement happens at the route boundary.
- Don't use the Effect-native `Database` service. `drizzleAdapter` needs promises — that is what `db/client` is for.
- Don't reintroduce a `fields` block for anything but `organizationId`. If a field name needs renaming, the schema is drifting from the plugin's conventions instead.
- Don't reorder `tanstackStartCookies()`.
- Don't regenerate the schema with `@better-auth/cli generate` and commit the output. The schema is hand-written in `schema.ts` with the house helpers; the CLI's output is a diff reference only.

## External references

- Decision records: [ADR 0051](../../docs/adr/0051-workspace-membership-on-better-auth-organization-plugin.md) (organization plugin), [ADR 0057](../../docs/adr/0057-social-sign-in-as-absent-until-configured-provider.md) (social sign-in), [ADR 0056](../../docs/adr/0056-passkeys-on-better-auth-passkey-plugin.md) (passkeys)
- Architecture security model: [`ARCHITECTURE.md`](../../ARCHITECTURE.md#security)
- Table shapes: [`@b2b-saas-starter/db`](../db/AGENTS.md)
- Live coverage: `src/live-auth.test.ts` — the plugin's endpoints against a real local D1. `src/live-passkey.test.ts` — the passkey ceremony end to end, including the two-factor bypass proof. `src/social-auth.test.ts` — the OAuth round-trip with GitHub's endpoints mocked at the `fetch` boundary.
