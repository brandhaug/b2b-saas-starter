# Env-gated Turnstile

The starter treats Cloudflare Turnstile as an env-gated optional provider for sign-up and sensitive public forms: disabled by default for local development, activated only when Turnstile site key and secret configuration exists.

**Status: wired (sign-up).** The client widget and the server-side verification of the sign-up mutation path are implemented:

- **Client.** `apps/web/src/components/turnstile-widget.tsx` renders the Turnstile challenge only when the page receives a site key; the key reaches `/sign-up` through `turnstileSiteKeyServerFn` (`apps/web/src/lib/server/turnstile.ts`), which returns `null` when `TURNSTILE_SITE_KEY` is unset so the form renders exactly as before. The solved token travels in an `x-turnstile-token` header via the page's `SignUpWithEmail` port — the Better Auth request body is untouched.
- **Server.** Before the auth catch-all dispatches to Better Auth (`apps/web/src/routes/api.auth.$.ts`), `gateTurnstileProtectedRequest` verifies the token against the Cloudflare `siteverify` endpoint when `TURNSTILE_SECRET_KEY` is configured, failing closed: a missing, rejected, or unverifiable token answers `400 TURNSTILE_FAILED`. With no secret configured the gate is inert — local development stays provider-light (cross-cutting rule 3).

Forgot-password protection remains a possible follow-up using the same two seams.
