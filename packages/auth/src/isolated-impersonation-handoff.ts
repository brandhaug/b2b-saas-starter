import type { D1Database, D1Result } from '@cloudflare/workers-types'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { makeSignature } from 'better-auth/crypto'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import type { Database } from '@b2b-saas-starter/db/client'
import * as schema from '@b2b-saas-starter/db/schema'
import type { MerchantAuth, MerchantAuthEmailSender } from './index.ts'

const handoffLifetimeSeconds = 60
const impersonationLifetimeSeconds = 60 * 60
const ticketBytes = 32

type CreateOperationsHandoffAuthOptions = {
  readonly db: Database
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: readonly string[]
  readonly production: boolean
  readonly sendVerificationEmail: MerchantAuthEmailSender
}

/** Test-only realm: the next ticket owns the ADR 0064 production factory. */
export const createOperationsHandoffAuth = (
  options: CreateOperationsHandoffAuthOptions
) =>
  betterAuth({
    appName: 'Operations App Handoff Spike',
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [...options.trustedOrigins],
    database: drizzleAdapter(options.db, { provider: 'sqlite', schema }),
    advanced: {
      cookiePrefix: 'operations',
      useSecureCookies: options.production,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: options.production
      }
    },
    session: { cookieCache: { enabled: false } },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: options.sendVerificationEmail
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true
    },
    plugins: [tanstackStartCookies()]
  })

type OperationsHandoffAuth = ReturnType<typeof createOperationsHandoffAuth>

type IsolatedImpersonationHandoffOptions = {
  readonly d1: D1Database
  readonly operationsAuth: OperationsHandoffAuth
  readonly merchantAuth: MerchantAuth
  readonly operationsOrigin: string
  readonly merchantOrigin: string
  readonly now?: () => Date
  /** Integration-only deterministic value for proving D1 rollback behavior. */
  readonly sessionId?: () => string
}

// This module is deliberately package-internal. It is an executable security
// spike, not the production Effect capability or accepted Impersonation Record
// from ADRs 0063/0065. Its D1 table exists only inside the integration test.

const jsonError = (status: number): Response =>
  Response.json({ error: 'impersonation_handoff_rejected' }, { status })

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const randomCredential = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(ticketBytes))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

const formValue = (form: FormData, name: string): string | undefined => {
  const value = form.get(name)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const containsControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

const isLocalPath = (value: string): boolean =>
  value.startsWith('/') &&
  !value.startsWith('//') &&
  !value.includes('\\') &&
  !containsControlCharacter(value)

const changed = (result: D1Result<unknown> | undefined): boolean =>
  (result?.meta.changes ?? 0) === 1

const expireMerchantCookie = (production: boolean): string =>
  `${production ? '__Secure-' : ''}merchant.session_token=; Max-Age=0; Path=/; HttpOnly;${production ? ' Secure;' : ''} SameSite=Lax`

/**
 * Executable integration spike for ADRs 0060 and 0063. Both handlers are HTTP
 * boundaries so the test exercises browser-visible redirects, forms, cookies,
 * Better Auth session resolution, and real D1 atomic batches.
 */
export const createIsolatedImpersonationHandoff = (
  options: IsolatedImpersonationHandoffOptions
) => {
  const now = options.now ?? (() => new Date())
  const merchantProduction = options.merchantOrigin.startsWith('https://')

  const operationsHandler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (
      request.method !== 'POST' ||
      url.origin !== options.operationsOrigin ||
      request.headers.get('origin') !== options.operationsOrigin
    ) {
      return jsonError(400)
    }

    const operator = await options.operationsAuth.api.getSession({
      headers: request.headers
    })
    if (!operator) return jsonError(401)

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return jsonError(400)
    }
    const targetUserId = formValue(form, 'targetUserId')
    const merchantId = formValue(form, 'merchantId')
    const returnPath = formValue(form, 'returnPath')
    if (!targetUserId || !merchantId || !returnPath || !isLocalPath(returnPath)) {
      return jsonError(400)
    }

    const target = await options.d1
      .prepare(
        `SELECT target.id
         FROM user AS target
         INNER JOIN merchant_memberships AS membership
           ON membership.user_id = target.id
         INNER JOIN merchants AS merchant
           ON merchant.id = membership.merchant_id
         WHERE target.id = ?1 AND merchant.id = ?2
           AND (target.banned IS NULL OR target.banned = 0)
         LIMIT 1`
      )
      .bind(targetUserId, merchantId)
      .first<{ readonly id: string }>()
    if (!target) return jsonError(400)

    const ticket = randomCredential()
    const issuedAt = Math.floor(now().getTime() / 1_000)
    const returnUrl = new URL(returnPath, options.operationsOrigin)
    returnUrl.searchParams.set('impersonation', 'stopped')
    await options.d1
      .prepare(
        `INSERT INTO impersonation_handoff_spike (
          id, ticket_hash, operator_user_id, operator_session_id,
          target_user_id, merchant_id, merchant_origin, operations_return_url,
          status, expires_at, createdAt, updatedAt
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?10, ?10)`
      )
      .bind(
        crypto.randomUUID(),
        await sha256(ticket),
        operator.user.id,
        operator.session.id,
        targetUserId,
        merchantId,
        options.merchantOrigin,
        returnUrl.toString(),
        issuedAt + handoffLifetimeSeconds,
        issuedAt
      )
      .run()

    const body = `<!doctype html><html><body><form id="handoff" action="${options.merchantOrigin}/impersonation/handoffs/exchange" method="post"><input type="hidden" name="ticket" value="${ticket}"></form><script>document.getElementById('handoff').submit()</script></body></html>`
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      }
    })
  }

  const exchange = async (request: Request): Promise<Response> => {
    if (request.headers.get('origin') !== options.operationsOrigin) {
      return jsonError(400)
    }
    const existing = await options.merchantAuth.api.getSession({
      headers: request.headers
    })
    if (existing) return jsonError(409)

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return jsonError(400)
    }
    const ticket = formValue(form, 'ticket')
    if (!ticket || ticket.length !== 43) return jsonError(400)

    const timestamp = Math.floor(now().getTime() / 1_000)
    const sessionId = options.sessionId?.() ?? crypto.randomUUID()
    const sessionToken = randomCredential()
    const ticketHash = await sha256(ticket)

    try {
      await options.d1
        .prepare(
          `UPDATE impersonation_handoff_spike
           SET status = 'expired', updatedAt = ?1
           WHERE ticket_hash = ?2 AND status = 'pending' AND expires_at <= ?1`
        )
        .bind(timestamp, ticketHash)
        .run()
      const results = await options.d1.batch([
        options.d1
          .prepare(
            `UPDATE impersonation_handoff_spike AS handoff
             SET status = 'active', merchant_session_id = ?1,
                 consumed_at = ?2, updatedAt = ?2
             WHERE handoff.ticket_hash = ?3 AND handoff.status = 'pending'
               AND handoff.merchant_session_id IS NULL AND handoff.expires_at > ?2
               AND handoff.merchant_origin = ?4
               AND EXISTS (
                 SELECT 1
                 FROM user AS target
                 INNER JOIN merchant_memberships AS membership
                   ON membership.user_id = target.id
                 WHERE target.id = handoff.target_user_id
                   AND membership.merchant_id = handoff.merchant_id
                   AND (target.banned IS NULL OR target.banned = 0)
               )
               AND EXISTS (
                 SELECT 1
                 FROM session AS operator_session
                 INNER JOIN user AS operator
                   ON operator.id = operator_session.userId
                 WHERE operator_session.id = handoff.operator_session_id
                   AND operator_session.userId = handoff.operator_user_id
                   AND operator_session.expiresAt > ?2
                   AND (operator.banned IS NULL OR operator.banned = 0)
               )`
          )
          .bind(sessionId, timestamp, ticketHash, options.merchantOrigin),
        options.d1
          .prepare(
            `INSERT INTO session (
               id, expiresAt, token, createdAt, updatedAt,
               userId, impersonatedBy
             )
             SELECT ?1, ?2, ?3, ?4, ?4, target_user_id, operator_user_id
             FROM impersonation_handoff_spike
             WHERE ticket_hash = ?5 AND status = 'active'
               AND merchant_session_id = ?1 AND consumed_at = ?4`
          )
          .bind(
            sessionId,
            timestamp + impersonationLifetimeSeconds,
            sessionToken,
            timestamp,
            ticketHash
          )
      ])
      if (!changed(results[0]) || !changed(results[1])) return jsonError(400)
    } catch {
      return jsonError(503)
    }

    const signedToken = `${sessionToken}.${await makeSignature(
      sessionToken,
      // Better Auth signs this cookie with the Merchant realm secret. The
      // factory keeps the secret private, so the spike captures it explicitly
      // from the initialized context rather than sharing Operations material.
      (await options.merchantAuth.$context).secret
    )}`
    const cookieName = `${merchantProduction ? '__Secure-' : ''}merchant.session_token`
    return new Response(null, {
      status: 303,
      headers: {
        location: `${options.merchantOrigin}/`,
        'set-cookie': `${cookieName}=${signedToken}; Max-Age=${impersonationLifetimeSeconds}; Path=/; HttpOnly;${merchantProduction ? ' Secure;' : ''} SameSite=Lax`,
        'cache-control': 'no-store'
      }
    })
  }

  const stop = async (request: Request): Promise<Response> => {
    if (request.headers.get('origin') !== options.merchantOrigin) {
      return jsonError(400)
    }
    const current = await options.merchantAuth.api.getSession({
      headers: request.headers
    })
    if (!current?.session.impersonatedBy) return jsonError(401)
    const timestamp = Math.floor(now().getTime() / 1_000)
    const record = await options.d1
      .prepare(
        `SELECT operations_return_url
         FROM impersonation_handoff_spike
         WHERE merchant_session_id = ?1 AND status = 'active' LIMIT 1`
      )
      .bind(current.session.id)
      .first<{ readonly operations_return_url: string }>()
    if (!record) return jsonError(401)

    try {
      const results = await options.d1.batch([
        options.d1
          .prepare(
            `UPDATE impersonation_handoff_spike
             SET status = 'stopped', stopped_at = ?1, updatedAt = ?1
             WHERE merchant_session_id = ?2 AND status = 'active'`
          )
          .bind(timestamp, current.session.id),
        options.d1
          .prepare(
            `DELETE FROM session WHERE id = ?1 AND impersonatedBy = ?2
             AND EXISTS (
               SELECT 1 FROM impersonation_handoff_spike
               WHERE merchant_session_id = ?1 AND status = 'stopped'
                 AND stopped_at = ?3
             )`
          )
          .bind(current.session.id, current.session.impersonatedBy, timestamp)
      ])
      if (!changed(results[0]) || !changed(results[1])) return jsonError(503)
    } catch {
      return jsonError(503)
    }

    return new Response(null, {
      status: 303,
      headers: {
        location: record.operations_return_url,
        'set-cookie': expireMerchantCookie(merchantProduction),
        'cache-control': 'no-store'
      }
    })
  }

  const merchantHandler = (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (url.origin !== options.merchantOrigin || request.method !== 'POST') {
      return Promise.resolve(jsonError(400))
    }
    if (url.pathname === '/impersonation/handoffs/exchange') return exchange(request)
    if (url.pathname === '/impersonation/stop') return stop(request)
    return Promise.resolve(jsonError(404))
  }

  return { operationsHandler, merchantHandler }
}
