/**
 * Cloudflare Turnstile server-side verification (ADR 0031). Env-gated: with
 * no secret configured the whole module is inert — verification is
 * 'skipped', never a failure, so local development stays provider-light.
 * With a secret configured the gate fails closed: a missing or rejected
 * token is a hard stop on the guarded request.
 */
import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { Exit, Schema } from 'effect'

/**
 * The public half of the pair: the site key reaches the sign-up page through
 * this server fn (always resolved server-side, even on client navigations).
 * `null` when unset — the widget then never renders.
 */
export const turnstileSiteKeyServerFn = createServerFn({ method: 'GET' }).handler(
  (): string | null => env.TURNSTILE_SITE_KEY ?? null
)

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileVerification =
  | { readonly outcome: 'skipped' }
  | { readonly outcome: 'passed' }
  | { readonly outcome: 'failed'; readonly reason: string }

const SiteverifyResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  'error-codes': Schema.optional(Schema.Array(Schema.String))
})

/** Compiled once — siteverify responses are untrusted network input. */
const decodeSiteverifyResponse = Schema.decodeUnknownExit(SiteverifyResponseSchema)

/**
 * The one network-touching step, injected so tests never leave the process.
 * `fetch` is global in workers and Node ≥18 — callers pass nothing in
 * production.
 */
/**
 * The slice of `fetch` this module uses. Structural, so tests hand in a plain
 * function and production passes the global without ceremony.
 */
export type FetchLike = (
  input: string,
  init?: { readonly method?: string; readonly body?: FormData }
) => Promise<Response>

async function readSiteverify(
  input: {
    readonly secret: string
    readonly token: string
    readonly remoteIp?: string | undefined
  },
  fetchImpl: FetchLike
): Promise<TurnstileVerification> {
  const body = new FormData()
  body.set('secret', input.secret)
  body.set('response', input.token)
  if (input.remoteIp) body.set('remoteip', input.remoteIp)
  // Network failures and non-2xx both close the gate rather than open it.
  const response = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body }).catch(
    () => null
  )
  if (!response || !response.ok) {
    return { outcome: 'failed', reason: 'siteverify_unavailable' }
  }
  // Parse the untrusted body at this boundary; anything unreadable counts as
  // a rejection so a malformed response can never open the gate.
  const rawBody: unknown = await response.json().catch(() => null)
  if (rawBody === null) return { outcome: 'failed', reason: 'siteverify_unparseable' }
  const decoded = decodeSiteverifyResponse(rawBody)
  if (!Exit.isSuccess(decoded)) {
    return { outcome: 'failed', reason: 'siteverify_unparseable' }
  }
  if (decoded.value.success) return { outcome: 'passed' }
  const [code] = decoded.value['error-codes'] ?? []
  return { outcome: 'failed', reason: code ?? 'verification_rejected' }
}

/**
 * The request-level gate the auth catch-all composes before Better Auth runs.
 * Returns a 400 response when the guarded sign-up path fails verification,
 * `undefined` (continue) for everything else — unconfigured deployments and
 * all other paths included. The token rides an `x-turnstile-token` header so
 * the Better Auth body schema stays untouched.
 */
export const TURNSTILE_TOKEN_HEADER = 'x-turnstile-token'
const PROTECTED_PATH = '/api/auth/sign-up/email'

export async function gateTurnstileProtectedRequest(
  request: Request,
  input: {
    readonly secret?: string | undefined
    readonly fetchImpl?: FetchLike
  }
): Promise<Response | undefined> {
  if (!input.secret) return undefined
  const { pathname } = new URL(request.url)
  if (request.method !== 'POST' || pathname !== PROTECTED_PATH) return undefined
  const remoteIp = request.headers.get('cf-connecting-ip') ?? undefined
  const verification = await verifyTurnstileToken({
    secret: input.secret,
    token: request.headers.get(TURNSTILE_TOKEN_HEADER),
    remoteIp,
    fetchImpl: input.fetchImpl
  })
  if (verification.outcome !== 'failed') return undefined
  return new Response(
    JSON.stringify({
      code: 'TURNSTILE_FAILED',
      message: 'Human verification failed. Please retry the challenge.'
    }),
    { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } }
  )
}

/**
 * Verify one Turnstile token. Unconfigured (no secret) → skipped; configured
 * with a missing token or a failed/rejected check → failed, closed.
 */
export async function verifyTurnstileToken(input: {
  readonly secret?: string | undefined
  readonly token?: string | null | undefined
  readonly remoteIp?: string | undefined
  readonly fetchImpl?: FetchLike | undefined
}): Promise<TurnstileVerification> {
  if (!input.secret) return { outcome: 'skipped' }
  if (!input.token) {
    return { outcome: 'failed', reason: 'missing_turnstile_token' }
  }
  const siteverifyInput =
    input.remoteIp === undefined
      ? { secret: input.secret, token: input.token }
      : { secret: input.secret, token: input.token, remoteIp: input.remoteIp }
  return readSiteverify(siteverifyInput, input.fetchImpl ?? fetch)
}
