# turnstile-verification

## Public surface

`TurnstileVerifier` — server-side verification of Cloudflare Turnstile tokens against `siteverify`, for public forms (sign-up first, ADR 0031).

- `enabled` — true only when built with a non-empty `TURNSTILE_SECRET_KEY`.
- `verify({ token, remoteIp? })` — `inactive` when unconfigured (provider-light: callers proceed), `verified`, or `rejected` with Cloudflare's error codes. Transport failures and unparseable responses surface as `CapabilityUnavailable('turnstile-verification')` so callers fail closed with infrastructure semantics.

## Storage

None. One adapter; the HTTP call is the injectable `SiteverifyCaller` port. No Seed/Live split because there is no store — do not add one.

## Anti-patterns

- Don't branch on env vars at the call site to decide whether to verify — call `verify` and gate on its outcome.
- Don't treat an unparseable siteverify answer as a rejection: it is unavailability, not a bot verdict.
