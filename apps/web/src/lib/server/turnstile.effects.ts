import {
  makeTurnstileVerifier,
  TurnstileVerifier
} from '@b2b-saas-starter/capabilities/governance/turnstile-verification'
import { hasValue } from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'
import { Layer, Redacted } from 'effect'

/** Per-request verifier layer, built from worker env like the rate limiter's. */
// oxlint-disable-next-line effecttsgo/lazy-effect -- reads the secret from worker env at request time, not at module import
export function makeTurnstileLayer() {
  const secretKey = env.TURNSTILE_SECRET_KEY
  return Layer.succeed(TurnstileVerifier)(
    makeTurnstileVerifier({
      secretKey: hasValue(secretKey) ? Redacted.make(secretKey) : undefined
    })
  )
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
