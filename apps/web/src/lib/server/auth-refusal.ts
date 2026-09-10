/**
 * The one JSON refusal body every pre-handler auth gate answers with.
 *
 * Better Auth serializes its own `APIError` as `{ code, message }` (what
 * `better-call` writes), and the sign-in screens probe that shape, so every
 * refusal this app adds ahead of the plugin — strong authentication, SSO
 * routing, impersonation, the two-factor gate, Turnstile, rate limiting, the
 * missing-local-D1 guidance — uses the same constructor rather than its own
 * copy of the headers.
 *
 * `detail` carries the optional fields a specific refusal adds: `message`
 * where a screen renders the sentence, `action` where the impersonation guard
 * names the account action it refused.
 */
export function authRefusal(
  status: number,
  code: string,
  detail?: {
    readonly message?: string | undefined
    readonly action?: string | undefined
  }
): Response {
  // `JSON.stringify` drops an undefined value, so an absent detail is an
  // absent field on the wire — the `{ code }`-only body every refusal but two
  // answers with.
  const body = { code, message: detail?.message, action: detail?.action }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}
