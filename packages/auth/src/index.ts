import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins/admin'
import { username } from 'better-auth/plugins/username'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
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
      tanstackStartCookies(),
      username(),
      admin({
        adminRoles: ['admin']
      })
    ]
  })
}

export type Auth = ReturnType<typeof createAuth>
export type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>
