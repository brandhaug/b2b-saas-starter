# Env-gated Turnstile

Turnstile protects registration and magic-link requests when both site and secret keys are configured. The browser receives only the site key; the auth boundary verifies the submitted token before Better Auth runs. Rejected challenges return a client error and unavailable verification fails closed. With both keys absent, local development runs without a challenge.
