# Env-gated Turnstile

The starter treats Cloudflare Turnstile as an env-gated optional provider for sign-up and sensitive public forms: disabled by default for local development, activated only when Turnstile site key and secret configuration exists.

Both halves are wired. When `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set, `/sign-up` renders the challenge widget (site key delivered by a server function, never the secret) and the web worker's auth route verifies each sign-up's `x-turnstile-token` header against Cloudflare `siteverify` through the `TurnstileVerifier` capability before Better Auth processes the registration. A failed challenge is a 400 (`captcha_rejected`); siteverify being unreachable fails closed with 503 (`captcha_unavailable`). With the variables unset the capability reports `inactive`, no widget mounts, no verification runs — local development is unaffected.
