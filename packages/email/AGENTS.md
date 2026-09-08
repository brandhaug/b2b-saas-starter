# @b2b-saas-starter/email

`EmailDispatcher`, its two layers, and the React Email templates. Cloudflare Email is an Optional Provider Module (ADR 0014): with no binding the same call renders and logs the message, so auth and invitation flows complete locally. Notification recipients come from `packages/capabilities`; auth callbacks supply credential-email recipients.

## Contracts

- `selectEmailDispatcherLayer(env)` is the only reader of `EMAIL` and `CLOUDFLARE_EMAIL_FROM`, returning the Cloudflare layer only when both are present. A binding without a sender address means log mode, not an error.
- `NOTIFICATION_EMAIL_TEMPLATES` is `satisfies`-pinned to `NotificationKind`: a new DB enum kind is a type error until a template exists. Never loosen it to an index signature.
- Every template needs a `PreviewProps` static: the tests and react-email's preview server (`pnpm -C packages/email dev`) read it.
- `./tracked` adapts dispatcher results and errors into sanitized outcomes for [`EmailDelivery.trackedAttempt`](../email-delivery/AGENTS.md). The email-delivery package owns claims, persisted outcomes and metrics; keep that sequencing out of transport adapters.

## Changes

- `apps/web/src/lib/server/auth-emails.ts` adapts Better Auth callbacks (`packages/auth` declares the `AuthEmailSender` port, unable to import this sibling) and selects the layer once per isolate; `apps/background` per invocation (ADR 0061).
- Send receipts distinguish local logging from provider acceptance. Neither proves recipient-server delivery; only correlated provider events do. Auth callbacks propagate failures, while invitation callers return sanitized send status.
- Log mode logs the rendered text in full: a flow that emails a link is unfinishable if the log drops it.

## Boundaries

- Never read `EMAIL` or `CLOUDFLARE_EMAIL_FROM` at a call site, or call `render` or a mail API outside `EmailDispatcher`.
- Keep `./templates`, `react-email`, and `@react-email/*` in server code; `apps/web/scripts/assert-client-boundary.mjs` guards the browser bundle.

## Pitfalls

- `WorkspaceInvitationEmail` is also `./templates`'s `default` export, the only one. Import the named export; leave the default in place.
