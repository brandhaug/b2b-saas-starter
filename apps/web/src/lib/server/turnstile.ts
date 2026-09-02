import { makeTurnstileVerifierLayer } from '@b2b-saas-starter/capabilities/governance/turnstile-verification'
import { hasValue } from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'

/**
 * Turnstile wiring for the web app (ADR 0031). Both halves are env-gated:
 * with the TURNSTILE variables unset the layer verifies nothing (the
 * capability reports `inactive`) and the site key reads as `null`, so no
 * widget renders — the sign-up form behaves exactly as it does without the
 * provider.
 */

/** Per-request verifier layer, built from worker env like the rate limiter's. */
export function makeTurnstileLayer() {
  return makeTurnstileVerifierLayer({ secretKey: env.TURNSTILE_SECRET_KEY })
}

// Server-only read: the secret must never reach a client bundle; only the
// site key (safe to expose) crosses the server-function boundary below.
// `hasValue` is the shared "unset means inactive" test (`@b2b-saas-starter/env`),
// so an empty or null-forwarded site key renders no widget exactly like an
// absent one — the same verdict the verifier layer reaches on the secret.
const readSiteKey = createServerOnlyFn((): string | null => {
  const siteKey = env.TURNSTILE_SITE_KEY
  return hasValue(siteKey) ? siteKey : null
})

export const getTurnstileSiteKey = createServerFn({ method: 'GET' }).handler(
  readSiteKey
)
