# @b2b-saas-starter/email

`EmailDispatcher`, its two layers, and the React Email templates. Cloudflare Email is an Optional Provider Module (ADR 0014): with no binding the same call renders and logs the message, so auth and invitation flows complete locally. Notification recipients come from `packages/capabilities`; auth callbacks supply credential-email recipients.

## Contracts

- `selectEmailDispatcherLayer(env)` is the only reader of `EMAIL` and `CLOUDFLARE_EMAIL_FROM`, returning the Cloudflare layer only when both are present. A binding without a sender address means log mode, not an error: the Cloudflare layer itself renders and logs when no sender resolves.
- One `NotificationEmail` renders every kind. `NOTIFICATION_COPY` and `NOTIFICATION_PREVIEW_PROPS` are `satisfies`-pinned to `NotificationKind`: a new DB enum kind is a type error until it has copy and preview props. Never loosen either to an index signature, and never give the copy lookup a default arm — that is what silently sends announcement wording.
- Every auth template needs a `PreviewProps` static, and every notification kind an entry in `NOTIFICATION_PREVIEW_PROPS`: the tests and react-email's preview server (`pnpm -C packages/email dev`) read them.
- `./tracked` adapts dispatcher results and errors into sanitized outcomes for [`EmailDelivery.trackedAttempt`](../email-delivery/AGENTS.md). The email-delivery package owns claims, persisted outcomes and metrics; keep that sequencing out of transport adapters.

## Changes

- `apps/web/src/lib/server/auth-emails.ts` adapts Better Auth callbacks (`packages/auth` declares the `AuthEmailSender` port, unable to import this sibling) and selects the layer once per isolate; `apps/background` per invocation (ADR 0061).
- Send receipts distinguish local logging from provider acceptance. Neither proves recipient-server delivery; only correlated provider events do. Auth callbacks propagate failures, while invitation callers return sanitized send status.
- Log mode logs the rendered text in full: a flow that emails a link is unfinishable if the log drops it.

## Boundaries

- Never read `EMAIL` or `CLOUDFLARE_EMAIL_FROM` at a call site, or call `render` or a mail API outside `EmailDispatcher`.
- Keep `./templates`, `react-email`, and `@react-email/*` in server code; `apps/web/scripts/assert-client-boundary.mjs` guards the browser bundle.

## Pitfalls

- The account-security notices (two-factor, passkey, password, backup codes, recovery) share one `SecurityNoticeEmail`: no action link, ever. A button in an email the true owner never asked for is a phishing assist.
