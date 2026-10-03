# Application auth through a temporary origin

Read [auth rules](../../../../packages/auth/AGENTS.md) and
[deployment configuration](../../../../docs/deploying.md) before an authenticated
demo. Email admission and an application session are separate checks.

Use a disposable local database and synthetic users. Confirm which environment
source the chosen server loads before editing local settings; never print secret
values. Once the protected tunnel supplies its origin:

- Set local `BETTER_AUTH_URL` to that exact HTTPS origin and include it in local
  `BETTER_AUTH_TRUSTED_ORIGINS`. Preserve only other intentionally trusted local
  origins. Restart the app at the same verified loopback port while keeping the
  protected connector alive.
- For OAuth, configure the provider's exact callback URL for this origin using
  the configured provider and Better Auth route. This is a separate provider
  configuration change requiring authority over that OAuth app. If unavailable,
  use `/demo` or report OAuth unverified. A new tunnel requires new callbacks.
- Keep CSRF/origin checks, cookie protections, workspace authorization and
  privileged authentication intact. Never add `*.trycloudflare.com` as a trusted
  origin or disable security checks to make a preview work.
- Check sign-in, a permitted action and sign-out in the external browser. Local
  success does not verify external cookies or redirects. Passkeys may depend on
  their relying-party domain; do not promise existing localhost passkeys work
  on a temporary hostname.

Restore the prior local settings and remove temporary provider callbacks when
the review ends. For repeat authenticated reviews, prefer the existing Alchemy
preview workflow instead of maintaining changing origins.
