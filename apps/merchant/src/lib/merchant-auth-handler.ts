type MerchantAuth = {
  readonly handler: (request: Request) => Promise<Response>
  readonly getSession?: (headers: Headers) => Promise<{
    readonly session: {
      readonly id: string
      readonly createdAt: Date
      readonly impersonatedBy?: string | null | undefined
    }
  } | null>
}

type MerchantEmailDelivery = {
  readonly isConfigured: boolean
}

type MerchantAuthRateLimiter = {
  readonly take: (input: {
    readonly bucket: 'auth_read' | 'auth_write'
    readonly key: string
  }) => Promise<boolean>
}

export type CreateMerchantAuthHandlerOptions = {
  readonly auth: MerchantAuth
  readonly emailDelivery: MerchantEmailDelivery
  readonly environment: 'development' | 'test' | 'production'
  readonly rateLimiter: MerchantAuthRateLimiter
  readonly authorizeImpersonated?: (input: {
    readonly merchantSessionId: string
    readonly action:
      | 'identity-security.update'
      | 'mfa.update'
      | 'identity.delete'
      | 'credential-metadata.read'
      | 'merchant.navigate'
  }) => Promise<unknown>
}

const emailActions = new Set([
  '/api/auth/sign-up/email',
  '/api/auth/send-verification-email',
  '/api/auth/request-password-reset',
  '/api/auth/change-email'
])

const signUpAction = '/api/auth/sign-up/email'
const passwordReauthenticationActions = new Set([
  '/api/auth/change-email',
  '/api/auth/change-password'
])
const impersonatedActionFor = (
  pathname: string,
  method: string
):
  | 'identity-security.update'
  | 'mfa.update'
  | 'identity.delete'
  | 'credential-metadata.read'
  | 'merchant.navigate'
  | null => {
  if (!pathname.startsWith('/api/auth/')) return null
  if (method === 'POST') {
    if (pathname === '/api/auth/delete-user') return 'identity.delete'
    if (pathname.startsWith('/api/auth/two-factor/')) return 'mfa.update'
    return 'identity-security.update'
  }
  if (method !== 'GET') return null
  if (
    pathname === '/api/auth/list-sessions' ||
    pathname === '/api/auth/list-accounts' ||
    pathname === '/api/auth/get-access-token'
  ) {
    return 'credential-metadata.read'
  }
  return 'merchant.navigate'
}
const passwordReauthenticationWindowMs = 60 * 15 * 1_000

const jsonResponse = (body: object, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })

const normalizedEmail = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const email = value.trim().toLowerCase()
  return email.length > 0 ? email : undefined
}

const submittedEmail = async (request: Request): Promise<string | undefined> => {
  if (request.method !== 'POST') return undefined
  try {
    const body: unknown = await request.clone().json()
    if (typeof body !== 'object' || body === null) return undefined
    return normalizedEmail((body as { readonly email?: unknown }).email)
  } catch {
    return undefined
  }
}

const emailHash = async (email: string): Promise<string> => {
  const bytes = new TextEncoder().encode(email)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const clientIpKey = (request: Request): string => {
  const ip = request.headers.get('cf-connecting-ip')
  return ip ? `ip:${ip}` : `unkeyed:${new URL(request.url).pathname}`
}

const requiresEmailDelivery = (pathname: string): boolean => emailActions.has(pathname)

/**
 * Merchant App's public Better Auth boundary. It deliberately handles only
 * request policy: Better Auth owns credential and session semantics below it.
 * No request body is logged; the email-specific limit receives only a SHA-256
 * digest of the normalized address.
 */
export const createMerchantAuthHandler =
  (options: CreateMerchantAuthHandlerOptions) =>
  async (request: Request): Promise<Response> => {
    const bucket = request.method === 'POST' ? 'auth_write' : 'auth_read'
    const ipAllowed = await options.rateLimiter.take({
      bucket,
      key: clientIpKey(request)
    })
    if (!ipAllowed) {
      return jsonResponse({ error: 'rate_limited' }, 429)
    }

    const email = await submittedEmail(request)
    if (email) {
      const emailAllowed = await options.rateLimiter.take({
        bucket,
        key: `email:${await emailHash(email)}`
      })
      if (!emailAllowed) {
        return jsonResponse({ error: 'rate_limited' }, 429)
      }
    }

    const pathname = new URL(request.url).pathname
    const impersonatedAction = impersonatedActionFor(pathname, request.method)
    const currentSession =
      (impersonatedAction || passwordReauthenticationActions.has(pathname)) &&
      options.auth.getSession
        ? await options.auth.getSession(request.headers)
        : null

    if (currentSession?.session.impersonatedBy && impersonatedAction) {
      try {
        if (!options.authorizeImpersonated) throw new Error('guard unavailable')
        await options.authorizeImpersonated({
          merchantSessionId: currentSession.session.id,
          action: impersonatedAction
        })
      } catch {
        return jsonResponse({ error: 'impersonation_authority_denied' }, 403)
      }
      if (request.method === 'POST') {
        return jsonResponse({ error: 'impersonation_authority_denied' }, 403)
      }
    }

    if (passwordReauthenticationActions.has(pathname) && options.auth.getSession) {
      const session = currentSession
      if (!session) {
        return jsonResponse(
          { error: 'merchant_unauthorized', message: 'Sign in and retry this change.' },
          401
        )
      }
      if (
        Date.now() - session.session.createdAt.getTime() >=
        passwordReauthenticationWindowMs
      ) {
        return jsonResponse(
          {
            error: 'password_reauthentication_required',
            message:
              'Reauthenticate with your password before changing your email or password.'
          },
          403
        )
      }
    }

    if (
      options.environment === 'production' &&
      !options.emailDelivery.isConfigured &&
      requiresEmailDelivery(pathname)
    ) {
      if (pathname === signUpAction) {
        return jsonResponse(
          {
            code: 'merchant_email_needs_configuration',
            message: 'Merchant email verification is not configured yet.'
          },
          503
        )
      }
      // This is intentionally the same response for both existing and unknown
      // accounts, so an unavailable email provider cannot become an account
      // enumeration oracle.
      return jsonResponse({ error: 'email_delivery_unavailable' }, 503)
    }

    return options.auth.handler(request)
  }
