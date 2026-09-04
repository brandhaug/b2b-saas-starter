# @b2b-saas-starter/email

## Purpose & Scope

`EmailDispatcher`, its two layers, and the React Email templates. Cloudflare Email is an Optional Provider Module (ADR 0014): with no binding the same call renders and logs the message, so auth and invitation flows complete locally. Who gets emailed is `packages/capabilities`' decision.

## Entry Points & Contracts

- No subpath re-exports another. `./notification-templates` holds components only, `./notification-emails` the kind table.
- `selectEmailDispatcherLayer(env)` is the only reader of `EMAIL` and `CLOUDFLARE_EMAIL_FROM`, returning the Cloudflare layer only when both are present. A binding without a sender address means log mode, not an error.
- `SendEmailBinding` is structural, not workers-types' `SendEmail`; both worker env declarations name it, so the shapes never assign.
- `NOTIFICATION_EMAIL_TEMPLATES` is `satisfies`-pinned to `NotificationKind`: a new DB enum kind is a type error until a template exists. Never loosen it to an index signature.
- Every template needs a `PreviewProps` static: the tests and react-email's preview server (`pnpm -C packages/email dev`) read it.

## Usage Patterns

- `apps/web/src/lib/server/auth-emails.ts` adapts Better Auth callbacks (`packages/auth` declares the `AuthEmailSender` port, unable to import this sibling) and selects the layer once per isolate; `apps/background` per invocation (ADR 0061).
- Send failures are the caller's: invitations downgrade to `delivered: false`, auth callbacks propagate.
- Log mode logs the rendered text in full: a flow that emails a link is unfinishable if the log drops it.

## Anti-patterns

- Never read `EMAIL` or `CLOUDFLARE_EMAIL_FROM` at a call site, or call `render` or a mail API outside `EmailDispatcher`.
- Never import `./templates` or `@react-email/*` from browser-bound code; `apps/web/scripts/assert-client-boundary.mjs` fails the build.

## Dependencies & Edges

Consumed by [`apps/web`](../../apps/web/AGENTS.md) and [`apps/background`](../../apps/background/AGENTS.md); [`apps/api`](../../apps/api/AGENTS.md) wires no dispatcher by design.

## Patterns & Pitfalls

- `WorkspaceInvitationEmail` is also `./templates`'s `default` export, the only one. Import the named export; leave the default in place.
