import { makeTurnstileVerifierLayer } from '@b2b-saas-starter/capabilities/governance/turnstile-verification'
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
const readSiteKey = createServerOnlyFn((): string | null => {
  const siteKey = env.TURNSTILE_SITE_KEY
  if (siteKey === undefined || siteKey.length === 0) {
    return null
  }
  return siteKey
})

export const getTurnstileSiteKey = createServerFn({ method: 'GET' }).handler(
  readSiteKey
)
