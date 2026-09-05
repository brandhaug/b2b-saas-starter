import {
  clientKey,
  makeRateLimiter,
  type CloudflareRateLimit,
  type RateLimiterInterface as GenericRateLimiterInterface
} from '@b2b-saas-starter/rate-limit'
import {
  webFallbackLimits,
  webRateLimitBindingNames,
  type WebRateLimitBindingName,
  type WebRateLimitBucket
} from '@b2b-saas-starter/infra'
import { Context, Layer } from 'effect'

// Thin config module over @b2b-saas-starter/rate-limit: the binding names and
// fallback limits come from `@b2b-saas-starter/infra` — the same records the
// generated wrangler config and Alchemy's bindings are emitted from (a plain
// leaf module, safe for the client bundle) — so this file owns only the
// mechanism wiring. The mechanism (Cloudflare binding dispatch, module-scope
// in-memory fallback, degraded-mode telemetry, clientKey) lives in the shared
// package. The module-scope fallback store matters here: the auth route
// rebuilds the layer per request, so per-layer state would reset on every
// request and never limit anything.

// The env type is derived from the infra name record, not spelled: renaming a
// binding in infra renames the key here and in the generated wrangler config
// together, and a bucket added to infra surfaces here the moment its row is
// written.
export type RateLimitBindings = Readonly<
  Partial<Record<WebRateLimitBindingName, CloudflareRateLimit>>
>

export { clientKey }

// The web app's auth buckets are the infra table's `web*` union — the same
// rows the worker's rate-limit bindings are generated from.
type AuthRateLimitBucket = WebRateLimitBucket

export type RateLimiterInterface = GenericRateLimiterInterface<AuthRateLimitBucket>

export class RateLimiter extends Context.Service<RateLimiter, RateLimiterInterface>()(
  '@b2b-saas-starter/web/RateLimiter'
) {}

// The numbers live beside the specs in infra (the `auth_sign_in` budget is
// tight on purpose — see the note on `webRateLimitTuning` there); the
// annotation fails the build if a bucket ever lacks a row.
const FALLBACK_LIMITS: Record<AuthRateLimitBucket, number> = webFallbackLimits

function pickBinding(
  env: RateLimitBindings,
  bucket: AuthRateLimitBucket
): CloudflareRateLimit | undefined {
  return env[webRateLimitBindingNames[bucket]]
}

/**
 * Path suffixes that carry credential material and so land in the tight
 * `auth_sign_in` bucket: password and username sign-in, the magic-link send,
 * and the email one-time-code endpoints — sending a code or a link is an
 * email-sending primitive and verifying either is a guessable-credential
 * check, so all sit in the same bucket as a password guess (ADR 0030). The
 * password-reset request joins them in either spelling: the link flow and
 * its `/email-otp` sibling are the same mail-an-arbitrary-address primitive.
 */
const AUTH_SIGN_IN_SUFFIXES = [
  '/sign-in/email',
  '/sign-in/username',
  '/sign-in/magic-link',
  '/sign-in/email-otp',
  '/email-otp/send-verification-otp',
  '/email-otp/verify-email',
  // Suffix-matched so both the link flow (`/request-password-reset`) and
  // `/email-otp/request-password-reset` land here — the same reuse-by-suffix
  // the audit exchange table applies to this pair.
  '/request-password-reset',
  '/email-otp/reset-password'
]

/**
 * Bucket selection for an auth request: credential sign-in and one-time-code
 * endpoints land in `auth_sign_in`; other POSTs in `auth_write`; everything
 * else in `auth_read`.
 */
export function authRateLimitBucket(
  method: string,
  pathname: string
): AuthRateLimitBucket {
  if (method === 'POST') {
    for (const suffix of AUTH_SIGN_IN_SUFFIXES) {
      if (pathname.endsWith(suffix)) {
        return 'auth_sign_in'
      }
    }
  }
  return method === 'POST' ? 'auth_write' : 'auth_read'
}

export function makeRateLimiterLayer(env: RateLimitBindings): Layer.Layer<RateLimiter> {
  return Layer.succeed(RateLimiter)(
    makeRateLimiter({
      binding: (bucket) => pickBinding(env, bucket),
      fallbackLimits: FALLBACK_LIMITS
    })
  )
}
