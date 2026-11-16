# Turnstile verification

Call `TurnstileVerifier.verify` for public-form checks and gate on its outcome (ADR 0031). Callers must not duplicate provider-presence checks.

Unconfigured verification is `inactive` and permits local flows. `rejected` is a bot verdict; a failed request or malformed provider response is `unavailable`, which callers must refuse. The verifier itself never fails.

Tokens are single-use. Each `verify` call sends one `idempotency_key` and retries only `SiteverifyNoResponse` (no response arrived) under that key. A timeout, a non-2xx status, an unparseable body and a verdict-less body are `unavailable` without a retry. The status is checked before the body is decoded, so an error response cannot read as `rejected`; a non-2xx body is cancelled unread. Every `unavailable` annotates the wide event with `turnstileUnavailable` (`no_response`, `timeout`, `status_3xx`/`status_4xx`/`status_5xx`, `unparseable_body`, `no_verdict`); a new reason needs the logger's sanitization allowlist too.

The secret key is `Redacted`: the env reader applies `hasValue` and wraps it, `SiteverifyRequest.secret` carries it across the transport port, and only the siteverify POST body unwraps it. An empty `Redacted` secret still counts as unconfigured (`inactive`); the presence check reads its length and nothing else.

`SiteverifyTransport` is the injectable HTTP port: it returns the raw `Response` and fails only when none arrived. There is no persisted state and no Seed/Live split.
