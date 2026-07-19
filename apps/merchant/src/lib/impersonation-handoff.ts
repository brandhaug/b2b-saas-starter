import { makeSignature } from 'better-auth/crypto'
import { Effect } from 'effect'
import type { MerchantAuth } from '@b2b-saas-starter/auth'
import type { Database } from '@b2b-saas-starter/db/client'
import {
  OperationsContractDenied,
  OperationsImpersonation,
  makeOperationsImpersonationLayer
} from '@b2b-saas-starter/capabilities/operations'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'

type MerchantImpersonationHandoffOptions = {
  readonly db: Database
  readonly auth: MerchantAuth
  readonly merchantSecret: string
  readonly merchantOrigin: string
  readonly operationsOrigin: string
  readonly production: boolean
  readonly securityContact: string
  readonly now?: () => Date
  readonly sessionId?: () => string
  readonly sessionToken?: () => string
  readonly notificationIntentId?: () => string
}

const rejected = (status: 400 | 409 | 503): Response =>
  Response.json(
    { error: 'impersonation_handoff_rejected' },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      }
    }
  )

const ticketFrom = async (request: Request): Promise<string | null> => {
  try {
    const value = (await request.formData()).get('ticket')
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

/** Merchant App boundary for the single-use Operations-to-Merchant handoff. */
export const createMerchantImpersonationHandoffHandler = (
  options: MerchantImpersonationHandoffOptions
) => {
  const now = options.now ?? (() => new Date())
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (
      request.method !== 'POST' ||
      url.origin !== options.merchantOrigin ||
      url.pathname !== '/impersonation/handoffs/exchange' ||
      request.headers.get('origin') !== options.operationsOrigin
    ) {
      return rejected(400)
    }

    try {
      const existing = await options.auth.api.getSession({ headers: request.headers })
      if (existing) return rejected(409)
    } catch {
      return rejected(503)
    }

    const handoffTicket = await ticketFrom(request)
    if (!handoffTicket) return rejected(400)

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const impersonation = yield* OperationsImpersonation
          return yield* impersonation.activate({ handoffTicket })
        }).pipe(
          Effect.provide(
            makeOperationsImpersonationLayer(options.db, {
              now,
              securityContact: options.securityContact,
              ...(options.sessionId ? { sessionId: options.sessionId } : {}),
              ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
              ...(options.notificationIntentId
                ? { notificationIntentId: options.notificationIntentId }
                : {})
            })
          )
        )
      )
      const signedToken = `${result.sessionToken}.${await makeSignature(
        result.sessionToken,
        options.merchantSecret
      )}`
      const cookieName = `${options.production ? '__Secure-' : ''}merchant.session_token`
      const maxAge = Math.max(
        0,
        Math.floor((Date.parse(result.expiresAt) - now().getTime()) / 1_000)
      )
      return new Response(null, {
        status: 303,
        headers: {
          location: `${options.merchantOrigin}/`,
          'set-cookie': `${cookieName}=${signedToken}; Max-Age=${maxAge}; Path=/; HttpOnly;${options.production ? ' Secure;' : ''} SameSite=Lax`,
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer'
        }
      })
    } catch (error) {
      if (error instanceof OperationsContractDenied) return rejected(400)
      if (error instanceof CapabilityUnavailable) return rejected(503)
      return rejected(503)
    }
  }
}
