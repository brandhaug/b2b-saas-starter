# Env-gated Turnstile

The starter treats Cloudflare Turnstile as an optional provider module for sign-up and sensitive public forms: disabled by default for local development, activated only when Turnstile site key and secret configuration exists. Today only the configuration half is wired — `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` live in the shared env schema and the module reports `needs-config` until they are set. The widget and server-side verification on public forms are not yet implemented and remain the follow-up that completes the module.
