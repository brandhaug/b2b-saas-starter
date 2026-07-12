import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins/admin'
import { username } from 'better-auth/plugins/username'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from '@b2b-saas-starter/db/client'
import * as schema from '@b2b-saas-starter/db/schema'

export type CreateAuthOptions = {
  readonly db: Database
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins?: string[]
  readonly githubClientId?: string
  readonly githubClientSecret?: string
}

export function createAuth(options: CreateAuthOptions) {
  const socialProviders =
    options.githubClientId && options.githubClientSecret
      ? {
          github: {
            clientId: options.githubClientId,
            clientSecret: options.githubClientSecret
          }
        }
      : undefined

  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, {
      provider: 'sqlite',
      schema
    }),
    emailAndPassword: {
      enabled: true
    },
    socialProviders,
    plugins: [
      username(),
      admin({
        adminRoles: ['admin']
      }),
      // Better Auth requires cookie-integration plugins last so cookies set by
      // other plugins' hooks are forwarded to the framework cookie store.
      tanstackStartCookies()
    ]
  })
}

export type Auth = ReturnType<typeof createAuth>
export type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

const day = 60 * 60 * 24

/** The Merchant App's session contract (ADR 0054). */
export const merchantSessionPolicy = {
  expiresIn: day * 7,
  updateAge: day,
  freshAge: 60 * 15,
  // Better Auth applies this through `advanced.defaultCookieAttributes`.
  // Omitting `domain` is deliberate: Merchant cookies must remain host-only.
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    hostOnly: true
  }
} as const

export type MerchantAuthEmail = {
  readonly user: { readonly email: string }
  readonly url: string
  readonly token: string
}

export type MerchantAuthEmailSender = (
  data: MerchantAuthEmail,
  request?: Request
) => Promise<void>

export type CreateMerchantAuthOptions = {
  readonly db: Database
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins?: string[]
  readonly production: boolean
  readonly sendVerificationEmail: MerchantAuthEmailSender
  readonly sendResetPassword: MerchantAuthEmailSender
}

/**
 * A deliberately narrow Better Auth instance for Merchant Owners. It has no
 * admin, username, or social-provider plugins from the legacy starter auth
 * surface, and its cookie configuration is intentionally host-only.
 */
export function createMerchantAuth(options: CreateMerchantAuthOptions) {
  return betterAuth({
    appName: 'Merchant App',
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, {
      provider: 'sqlite',
      schema
    }),
    advanced: {
      cookiePrefix: 'merchant',
      useSecureCookies: options.production,
      defaultCookieAttributes: {
        httpOnly: merchantSessionPolicy.cookie.httpOnly,
        sameSite: merchantSessionPolicy.cookie.sameSite,
        secure: options.production
      }
    },
    session: {
      expiresIn: merchantSessionPolicy.expiresIn,
      updateAge: merchantSessionPolicy.updateAge,
      freshAge: merchantSessionPolicy.freshAge,
      // An authoritative D1 lookup keeps reset and sign-out revocations
      // immediately effective instead of accepting a cached session payload.
      cookieCache: { enabled: false }
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: options.sendVerificationEmail
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      sendResetPassword: options.sendResetPassword,
      revokeSessionsOnPasswordReset: true
    },
    user: {
      // Better Auth protects this endpoint with its sensitive-session
      // middleware, which uses the fifteen-minute `freshAge` above.
      changeEmail: { enabled: true }
    },
    plugins: [tanstackStartCookies()]
  })
}

export type MerchantAuth = ReturnType<typeof createMerchantAuth>

export type CreateCustomerAuthOptions = {
  readonly db: Database
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins?: string[]
  readonly production: boolean
  readonly google?: { readonly clientId: string; readonly clientSecret: string }
  readonly apple?: { readonly clientId: string; readonly clientSecret: string }
}

/**
 * Customer authentication is optional and is never a Merchant authorization
 * source. Its distinct cookie prefix prevents Merchant App sessions from being
 * presented as customer sessions even though Better Auth shares D1 storage.
 */
export function createCustomerAuth(options: CreateCustomerAuthOptions) {
  return betterAuth({
    appName: 'Booking Customer',
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, { provider: 'sqlite', schema }),
    advanced: {
      cookiePrefix: 'booking_customer',
      useSecureCookies: options.production,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: options.production
      }
    },
    session: {
      expiresIn: day * 30,
      updateAge: day,
      cookieCache: { enabled: false }
    },
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(options.google ? { google: options.google } : {}),
      ...(options.apple ? { apple: options.apple } : {})
    }
  })
}

export type CustomerAuth = ReturnType<typeof createCustomerAuth>

export type AuthenticatedCustomerPrincipal = {
  readonly provider: 'google' | 'apple'
  readonly providerSubject: string
  readonly email: string
  readonly emailVerified: true
  readonly displayName: string | null
}

export async function resolveCustomerPrincipal(input: {
  readonly auth: CustomerAuth
  readonly db: Database
  readonly headers: Headers
}): Promise<AuthenticatedCustomerPrincipal | null> {
  const current = await input.auth.api.getSession({ headers: input.headers })
  if (!current?.user.emailVerified) return null
  const [provider] = await input.db
    .select({
      providerId: schema.account.providerId,
      accountId: schema.account.accountId
    })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, current.user.id),
        inArray(schema.account.providerId, ['google', 'apple'])
      )
    )
    .orderBy(desc(schema.account.createdAt))
    .limit(1)
  if (
    !provider ||
    (provider.providerId !== 'google' && provider.providerId !== 'apple')
  )
    return null
  return {
    provider: provider.providerId,
    providerSubject: provider.accountId,
    email: current.user.email,
    emailVerified: true,
    displayName: current.user.name || null
  }
}
