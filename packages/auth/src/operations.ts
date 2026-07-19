import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAccessControl } from 'better-auth/plugins/access'
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins/two-factor'
import { hashPassword, symmetricEncrypt } from 'better-auth/crypto'
import { and, eq, ne } from 'drizzle-orm'
import type { Database } from '@b2b-saas-starter/db/client'
import * as schema from '@b2b-saas-starter/db/schema'

const hour = 60 * 60
const operatorAbsoluteLifetimeSeconds = 8 * hour
const operatorIdleLifetimeSeconds = 30 * 60

export const operatorRoleNames = [
  'merchant-reader',
  'merchant-impersonator',
  'impersonation-auditor',
  'operator-manager'
] as const
export type OperatorRoleName = (typeof operatorRoleNames)[number]

export const operatorPermissions = [
  'merchant:read',
  'merchant:impersonate',
  'impersonation-audit:read',
  'operator:manage'
] as const
export type OperatorPermission = (typeof operatorPermissions)[number]

export const operatorAccessControl = createAccessControl({
  merchant: ['read', 'impersonate'],
  'impersonation-audit': ['read'],
  operator: ['manage']
})

export const operatorRoles = {
  'merchant-reader': operatorAccessControl.newRole({ merchant: ['read'] }),
  'merchant-impersonator': operatorAccessControl.newRole({
    merchant: ['read', 'impersonate']
  }),
  'impersonation-auditor': operatorAccessControl.newRole({
    'impersonation-audit': ['read']
  }),
  'operator-manager': operatorAccessControl.newRole({ operator: ['manage'] })
} as const

const isOperatorRole = (value: string): value is OperatorRoleName =>
  operatorRoleNames.includes(value as OperatorRoleName)

export const parseOperatorRoles = (
  value: string | null | undefined
): OperatorRoleName[] => [
  ...new Set(
    (value ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter(isOperatorRole)
  )
]

const permissionStatement = (permission: OperatorPermission) => {
  const [resource, action] = permission.split(':') as [
    keyof typeof operatorAccessControl.statements,
    string
  ]
  return { [resource]: [action] } as never
}

export const hasOperatorPermission = (
  roles: readonly OperatorRoleName[],
  permission: OperatorPermission
): boolean =>
  roles.some(
    (role) => operatorRoles[role].authorize(permissionStatement(permission)).success
  )

export const operatorSessionPolicy = {
  absoluteLifetimeSeconds: operatorAbsoluteLifetimeSeconds,
  idleLifetimeSeconds: operatorIdleLifetimeSeconds,
  cookie: { prefix: 'operations', hostOnly: true, sameSite: 'lax' }
} as const

export type CreateOperationsAuthOptions = {
  readonly db: Database
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: readonly string[]
  readonly production: boolean
}

export const createOperationsAuth = (options: CreateOperationsAuthOptions) =>
  betterAuth({
    appName: 'Operations App',
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [...options.trustedOrigins],
    database: drizzleAdapter(options.db, { provider: 'sqlite', schema }),
    advanced: {
      cookiePrefix: operatorSessionPolicy.cookie.prefix,
      useSecureCookies: options.production,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: operatorSessionPolicy.cookie.sameSite,
        secure: options.production
      }
    },
    user: {
      additionalFields: {
        identityClass: {
          type: 'string',
          required: true,
          input: false,
          defaultValue: 'system_operator'
        }
      }
    },
    session: {
      expiresIn: operatorAbsoluteLifetimeSeconds,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      additionalFields: {
        operatorIdleExpiresAt: { type: 'date', required: false, input: false },
        operatorAbsoluteExpiresAt: { type: 'date', required: false, input: false }
      }
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const createdAt = session.createdAt ?? new Date()
            const createdAtMs = new Date(createdAt).getTime()
            return {
              data: {
                ...session,
                expiresAt: new Date(
                  createdAtMs + operatorAbsoluteLifetimeSeconds * 1_000
                ),
                operatorIdleExpiresAt: new Date(
                  createdAtMs + operatorIdleLifetimeSeconds * 1_000
                ),
                operatorAbsoluteExpiresAt: new Date(
                  createdAtMs + operatorAbsoluteLifetimeSeconds * 1_000
                )
              }
            }
          },
          after: async (created, context) => {
            if (context?.path !== '/two-factor/verify-totp') return
            await options.db
              .delete(schema.session)
              .where(
                and(
                  eq(schema.session.userId, created.userId),
                  ne(schema.session.id, created.id)
                )
              )
          }
        }
      }
    },
    plugins: [
      twoFactorPlugin({
        issuer: 'B2B SaaS Starter Operations',
        twoFactorCookieMaxAge: 5 * 60,
        trustDeviceMaxAge: 0
      })
    ]
  })

export type OperationsAuth = ReturnType<typeof createOperationsAuth>

const publicOperationsAuthPaths = new Set([
  '/sign-in/email',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/sign-out',
  '/get-session'
])

const authPath = (request: Request): string => {
  const pathname = new URL(request.url).pathname
  return pathname.startsWith('/api/auth')
    ? pathname.slice('/api/auth'.length) || '/'
    : pathname
}

export const createOperationsAuthHandler =
  (options: { readonly auth: OperationsAuth; readonly db: Database }) =>
  async (request: Request): Promise<Response> => {
    const path = authPath(request)
    if (!publicOperationsAuthPaths.has(path)) {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    if (path === '/sign-in/email') {
      let email: string | undefined
      try {
        const body = (await request.clone().json()) as { readonly email?: unknown }
        email = typeof body.email === 'string' ? body.email.toLowerCase() : undefined
      } catch {
        return Response.json({ error: 'authentication_failed' }, { status: 401 })
      }
      if (!email)
        return Response.json({ error: 'authentication_failed' }, { status: 401 })
      const [candidate] = await options.db
        .select({
          identityClass: schema.user.identityClass,
          enabled: schema.user.banned,
          twoFactorEnabled: schema.user.twoFactorEnabled
        })
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1)
      if (
        !candidate ||
        candidate.identityClass !== 'system_operator' ||
        candidate.enabled ||
        !candidate.twoFactorEnabled
      ) {
        return Response.json({ error: 'authentication_failed' }, { status: 401 })
      }
    }
    return options.auth.handler(request)
  }

export type OperatorPrincipal = {
  readonly id: string
  readonly sessionId: string
  readonly email: string
  readonly name: string
  readonly roles: readonly OperatorRoleName[]
  readonly idleExpiresAt: Date
  readonly absoluteExpiresAt: Date
}

export const resolveOperatorSession = async (input: {
  readonly auth: OperationsAuth
  readonly db: Database
  readonly headers: Headers
  readonly now?: Date
}): Promise<OperatorPrincipal | null> => {
  const current = await input.auth.api.getSession({ headers: input.headers })
  if (!current) return null
  const now = input.now ?? new Date()
  const [authoritative] = await input.db
    .select({ operator: schema.user, session: schema.session })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(eq(schema.session.id, current.session.id))
    .limit(1)
  const idleExpiresAt = authoritative?.session.operatorIdleExpiresAt
  const absoluteExpiresAt = authoritative?.session.operatorAbsoluteExpiresAt
  if (
    !authoritative ||
    authoritative.operator.identityClass !== 'system_operator' ||
    authoritative.operator.banned ||
    !authoritative.operator.emailVerified ||
    !authoritative.operator.twoFactorEnabled ||
    !idleExpiresAt ||
    !absoluteExpiresAt ||
    now >= idleExpiresAt ||
    now >= absoluteExpiresAt
  ) {
    return null
  }
  const nextIdle = new Date(
    Math.min(
      now.getTime() + operatorIdleLifetimeSeconds * 1_000,
      absoluteExpiresAt.getTime()
    )
  )
  await input.db
    .update(schema.session)
    .set({ operatorIdleExpiresAt: nextIdle })
    .where(eq(schema.session.id, authoritative.session.id))
  return {
    id: authoritative.operator.id,
    sessionId: authoritative.session.id,
    email: authoritative.operator.email,
    name: authoritative.operator.name,
    roles: parseOperatorRoles(authoritative.operator.role),
    idleExpiresAt: nextIdle,
    absoluteExpiresAt
  }
}

export type LocalOperatorFixture = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly password: string
  readonly totpSecret: string
  readonly roles: readonly OperatorRoleName[]
}

export const provisionLocalOperator = async (input: {
  readonly db: Database
  readonly secret: string
  readonly mode: 'development' | 'test' | 'production'
  readonly operator: LocalOperatorFixture
}): Promise<void> => {
  if (input.mode === 'production') {
    throw new Error('local operator provisioning is disabled outside local development')
  }
  const existing = await input.db
    .select({ id: schema.user.id, identityClass: schema.user.identityClass })
    .from(schema.user)
    .where(eq(schema.user.email, input.operator.email.toLowerCase()))
    .limit(1)
  if (existing[0] && existing[0].identityClass !== 'system_operator') {
    throw new Error('operator identity must be disjoint from product identities')
  }
  const now = new Date()
  const operatorId = existing[0]?.id ?? input.operator.id
  if (!existing[0]) {
    await input.db.insert(schema.user).values({
      id: operatorId,
      email: input.operator.email.toLowerCase(),
      name: input.operator.name,
      emailVerified: true,
      identityClass: 'system_operator',
      twoFactorEnabled: true,
      role: input.operator.roles.join(','),
      createdAt: now,
      updatedAt: now
    })
  } else {
    await input.db
      .update(schema.user)
      .set({
        name: input.operator.name,
        emailVerified: true,
        twoFactorEnabled: true,
        role: input.operator.roles.join(','),
        updatedAt: now
      })
      .where(eq(schema.user.id, operatorId))
    await input.db.delete(schema.account).where(eq(schema.account.userId, operatorId))
    await input.db
      .delete(schema.twoFactor)
      .where(eq(schema.twoFactor.userId, operatorId))
  }
  await input.db.insert(schema.account).values({
    id: `credential_${operatorId}`,
    accountId: operatorId,
    providerId: 'credential',
    userId: operatorId,
    password: await hashPassword(input.operator.password),
    createdAt: now,
    updatedAt: now
  })
  await input.db.insert(schema.twoFactor).values({
    id: `totp_${operatorId}`,
    userId: operatorId,
    secret: await symmetricEncrypt({
      key: input.secret,
      data: input.operator.totpSecret
    }),
    backupCodes: await symmetricEncrypt({ key: input.secret, data: '[]' }),
    verified: true,
    failedVerificationCount: 0
  })
}
