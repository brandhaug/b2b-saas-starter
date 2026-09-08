# Turnstile verification

Call `TurnstileVerifier.verify` for public-form checks and gate on its outcome (ADR 0031). Callers must not duplicate provider-presence checks.

Unconfigured verification is `inactive` and permits local flows. `rejected` is a bot verdict; a failed request or malformed provider response is `unavailable`, which callers must refuse. The verifier itself never fails.

`SiteverifyCaller` is the injectable HTTP port. There is no persisted state and no Seed/Live split.
