import { makeTurnstileVerifierLayer } from '@b2b-saas-starter/capabilities/governance/turnstile-verification'
import { hasValue } from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'

/**
 * Turnstile's server-only wiring (ADR 0031), reached through dynamic
 * `import()` from the client-safe `turnstile.ts`: the verifier layer factory
 * and the env-bag site-key read both pin `effect`/capabilities graphs that
 * must never ship to the browser.
 */

/** Per-request verifier layer, built from worker env like the rate limiter's. */
export function makeTurnstileLayer() {
  return makeTurnstileVerifierLayer({ secretKey: env.TURNSTILE_SECRET_KEY })
}

/**
 * The handler `getTurnstileSiteKey` delegates to. The secret must never reach
 * a client bundle; only the site key (safe to expose) crosses the
 * server-function boundary. `hasValue` is the shared "unset means inactive"
 * test (`@b2b-saas-starter/env`), so an empty or null-forwarded site key
 * renders no widget exactly like an absent one — the same verdict the
 * verifier layer reaches on the secret.
 */
export function readSiteKeyHandler(): string | null {
  const siteKey = env.TURNSTILE_SITE_KEY
  return hasValue(siteKey) ? siteKey : null
}
