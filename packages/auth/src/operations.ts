import { activeImpersonationRevocationStatements } from '@b2b-saas-starter/capabilities/operations'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAccessControl } from 'better-auth/plugins/access'
import { admin as adminPlugin } from 'better-auth/plugins/admin'
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins/two-factor'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import {
  hashPassword,
  symmetricDecrypt,
  symmetricEncrypt,
  verifyPassword
} from 'better-auth/crypto'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import {
  operatorRoleNames,
  operatorDefaultRole,
  operatorPermissionRegistry,
  operatorRoleRegistry,
  parseOperatorRoles,
  hasOperatorPermission,
  operatorPermissionNames,
  type OperatorPrincipal,
  type OperatorPermission,
  type OperatorRole as OperatorRoleName,
  type OperatorSessionReference
} from '@b2b-saas-starter/capabilities/operations'
import type { Database } from '@b2b-saas-starter/db/client'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import * as schema from '@b2b-saas-starter/db/schema'

const hour = 60 * 60
const operatorAbsoluteLifetimeSeconds = 8 * hour
const operatorIdleLifetimeSeconds = 30 * 60

export { operatorRoleNames, parseOperatorRoles }
export type { OperatorPrincipal, OperatorRoleName, OperatorSessionReference }

export const operatorPermissions = operatorPermissionNames
export type { OperatorPermission }

type OperatorAccessControlStatements = {
  [Resource in keyof typeof operatorPermissionRegistry]: Array<
    (typeof operatorPermissionRegistry)[Resource][number]
  >
}

const operatorAccessControlStatements = Object.fromEntries(
  Object.entries(operatorPermissionRegistry).map(([resource, actions]) => [
    resource,
    [...actions]
  ])
) as OperatorAccessControlStatements

export const operatorAccessControl = createAccessControl(
  operatorAccessControlStatements
)

type OperatorAccessStatement = Parameters<typeof operatorAccessControl.newRole>[0]
type OperatorAccessRole = ReturnType<typeof operatorAccessControl.newRole>

const accessStatement = (
  permissions: readonly OperatorPermission[]
): OperatorAccessStatement => {
  const statement: Record<string, string[]> = {}
  for (const permission of permissions) {
    const [resource, action] = permission.split(':')
    if (!resource || !action)
      throw new Error(`Invalid Operator Permission: ${permission}`)
    const actions = statement[resource] ?? []
    actions.push(action)
    statement[resource] = actions
  }
  return statement as OperatorAccessStatement
}

export const operatorRoles = Object.fromEntries(
  operatorRoleNames.map((role) => [
    role,
    operatorAccessControl.newRole(
      accessStatement(operatorRoleRegistry[role].permissions)
    )
  ])
) as Readonly<Record<OperatorRoleName, OperatorAccessRole>>

export { hasOperatorPermission }

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
  readonly securityContact: string
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
        operatorAbsoluteExpiresAt: { type: 'date', required: false, input: false },
        operatorTotpVerifiedAt: { type: 'date', required: false, input: false }
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
            if (
              context?.path !== '/two-factor/verify-totp' &&
              context?.path !== '/two-factor/verify-backup-code'
            )
              return
            if (context.path === '/two-factor/verify-totp') {
              await options.db
                .update(schema.session)
                .set({ operatorTotpVerifiedAt: created.createdAt ?? new Date() })
                .where(eq(schema.session.id, created.id))
            }
            const raw = options.db.$client
            const occurredAt = created.createdAt ?? new Date()
            const revocations = activeImpersonationRevocationStatements({
              selector: {
                operatorId: created.userId,
                exceptOperatorSessionId: created.id
              },
              cause: 'operator-session-replaced',
              occurredAt,
              securityContact: options.securityContact
            })
            const deletePreviousSessions = options.db
              .delete(schema.session)
              .where(
                and(
                  eq(schema.session.userId, created.userId),
                  ne(schema.session.id, created.id)
                )
              )
              .toSQL()
            await raw.batch([
              ...revocations.map((statement) =>
                raw.prepare(statement.sql).bind(...statement.params)
              ),
              raw
                .prepare(deletePreviousSessions.sql)
                .bind(...deletePreviousSessions.params)
            ])
          }
        }
      }
    },
    plugins: [
      adminPlugin({
        ac: operatorAccessControl,
        roles: operatorRoles,
        defaultRole: operatorDefaultRole,
        adminRoles: ['operator-manager']
      }),
      twoFactorPlugin({
        issuer: 'B2B SaaS Starter Operations',
        twoFactorCookieMaxAge: 5 * 60,
        trustDeviceMaxAge: 0,
        backupCodeOptions: { storeBackupCodes: 'encrypted' }
      }),
      tanstackStartCookies()
    ]
  })

export type OperationsAuth = ReturnType<typeof createOperationsAuth>

const publicOperationsAuthPaths = new Set([
  '/sign-in/email',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/sign-out'
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
      let password: string | undefined
      try {
        const body = (await request.clone().json()) as {
          readonly email?: unknown
          readonly password?: unknown
        }
        email = typeof body.email === 'string' ? body.email.toLowerCase() : undefined
        password = typeof body.password === 'string' ? body.password : undefined
      } catch {
        return Response.json({ error: 'authentication_failed' }, { status: 401 })
      }
      if (!email)
        return Response.json({ error: 'authentication_failed' }, { status: 401 })
      const [candidate] = await options.db
        .select({
          id: schema.user.id,
          identityClass: schema.user.identityClass,
          banned: schema.user.banned,
          emailVerified: schema.user.emailVerified,
          twoFactorEnabled: schema.user.twoFactorEnabled
        })
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1)
      if (
        !candidate ||
        candidate.identityClass !== 'system_operator' ||
        candidate.banned
      ) {
        return Response.json({ error: 'authentication_failed' }, { status: 401 })
      }
      const [incomplete] = await options.db
        .select({ password: schema.account.password })
        .from(schema.operatorEnrollments)
        .innerJoin(
          schema.account,
          and(
            eq(schema.account.userId, schema.operatorEnrollments.operatorId),
            eq(schema.account.providerId, 'credential')
          )
        )
        .where(
          and(
            eq(schema.operatorEnrollments.operatorId, candidate.id),
            isNull(schema.operatorEnrollments.completedAt)
          )
        )
        .limit(1)
      if (incomplete) {
        if (
          candidate.emailVerified &&
          password &&
          incomplete.password &&
          (await verifyPassword({ hash: incomplete.password, password }))
        ) {
          return Response.json(
            { error: 'enrollment_required', operatorId: candidate.id },
            { status: 403 }
          )
        }
        return Response.json({ error: 'authentication_failed' }, { status: 401 })
      }
      if (!candidate.twoFactorEnabled)
        return Response.json({ error: 'authentication_failed' }, { status: 401 })
    }
    return options.auth.handler(request)
  }

export const readOperatorSessionReference = async (input: {
  readonly auth: OperationsAuth
  readonly headers: Headers
}): Promise<OperatorSessionReference | null> => {
  const current = await input.auth.api.getSession({ headers: input.headers })
  return current ? { operatorSessionId: current.session.id } : null
}

const randomTotpSecret = (): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')
}

const randomBackupCodes = (): readonly string[] => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from({ length: 10 }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(10))
    const code = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')
    return `${code.slice(0, 5)}-${code.slice(5)}`
  })
}

export const beginOperatorTwoFactorEnrollment = async (input: {
  readonly db: Database
  readonly secret: string
  readonly operatorId: string
  readonly password: string
}): Promise<{ readonly totpURI: string; readonly backupCodes: readonly string[] }> => {
  const [credential] = await input.db
    .select({ password: schema.account.password, email: schema.user.email })
    .from(schema.account)
    .innerJoin(schema.user, eq(schema.user.id, schema.account.userId))
    .where(
      and(
        eq(schema.account.userId, input.operatorId),
        eq(schema.account.providerId, 'credential'),
        eq(schema.user.identityClass, 'system_operator')
      )
    )
    .limit(1)
  if (
    !credential?.password ||
    !(await verifyPassword({ hash: credential.password, password: input.password }))
  ) {
    throw new Error('operator enrollment password is invalid')
  }
  const totpSecret = randomTotpSecret()
  const backupCodes = randomBackupCodes()
  await input.db.batch([
    input.db
      .delete(schema.twoFactor)
      .where(eq(schema.twoFactor.userId, input.operatorId)),
    input.db.insert(schema.twoFactor).values({
      id: `totp_${crypto.randomUUID()}`,
      userId: input.operatorId,
      secret: await symmetricEncrypt({ key: input.secret, data: totpSecret }),
      backupCodes: await symmetricEncrypt({
        key: input.secret,
        data: JSON.stringify(backupCodes)
      }),
      verified: false,
      failedVerificationCount: 0
    })
  ])
  const issuer = 'B2B SaaS Starter Operations'
  return {
    totpURI: `otpauth://totp/${encodeURIComponent(`${issuer}:${credential.email}`)}?secret=${totpSecret}&issuer=${encodeURIComponent(issuer)}`,
    backupCodes
  }
}

export const hashOperatorEnrollmentPassword = (password: string): Promise<string> =>
  hashPassword(password)

export const verifyOperatorTwoFactorEnrollment = async (input: {
  readonly auth: OperationsAuth
  readonly db: Database
  readonly secret: string
  readonly operatorId: string
  readonly code: string
}): Promise<void> => {
  const [factor] = await input.db
    .select({ id: schema.twoFactor.id, secret: schema.twoFactor.secret })
    .from(schema.twoFactor)
    .where(eq(schema.twoFactor.userId, input.operatorId))
    .limit(1)
  if (!factor) throw new Error('operator TOTP enrollment is unavailable')
  const totpSecret = await symmetricDecrypt({ key: input.secret, data: factor.secret })
  const generated = await input.auth.api.generateTOTP({ body: { secret: totpSecret } })
  if (generated.code !== input.code) throw new Error('operator TOTP code is invalid')
  await input.db.batch([
    input.db
      .update(schema.twoFactor)
      .set({ verified: true, failedVerificationCount: 0, lockedUntil: null })
      .where(eq(schema.twoFactor.id, factor.id)),
    input.db
      .update(schema.user)
      .set({ twoFactorEnabled: true, updatedAt: new Date() })
      .where(eq(schema.user.id, input.operatorId))
  ])
}

export class OperatorTotpPresenceDenied extends Schema.TaggedErrorClass<OperatorTotpPresenceDenied>()(
  'OperatorTotpPresenceDenied',
  { reason: Schema.String }
) {}

export const verifyOperatorTotpPresence = (input: {
  readonly auth: OperationsAuth
  readonly db: Database
  readonly secret: string
  readonly operatorId: string
  readonly operatorSessionId: string
  readonly code: string
  readonly verifiedAt?: Date
}): Effect.Effect<void, OperatorTotpPresenceDenied | CapabilityUnavailable> =>
  Effect.tryPromise({
    try: async () => {
      const challengeDenied = () =>
        new OperatorTotpPresenceDenied({ reason: 'operator TOTP challenge failed' })
      if (!/^\d{6}$/.test(input.code.trim())) throw challengeDenied()
      const [factor] = await input.db
        .select({
          secret: schema.twoFactor.secret,
          verified: schema.twoFactor.verified,
          lockedUntil: schema.twoFactor.lockedUntil
        })
        .from(schema.twoFactor)
        .innerJoin(schema.user, eq(schema.user.id, schema.twoFactor.userId))
        .where(
          and(
            eq(schema.twoFactor.userId, input.operatorId),
            eq(schema.user.identityClass, 'system_operator'),
            eq(schema.user.twoFactorEnabled, true),
            eq(schema.user.banned, false)
          )
        )
        .limit(1)
      const verifiedAt = input.verifiedAt ?? new Date()
      if (
        !factor?.verified ||
        (factor.lockedUntil !== null && factor.lockedUntil > verifiedAt)
      )
        throw challengeDenied()
      const totpSecret = await symmetricDecrypt({
        key: input.secret,
        data: factor.secret
      })
      const generated = await input.auth.api.generateTOTP({
        body: { secret: totpSecret }
      })
      if (generated.code !== input.code.trim()) throw challengeDenied()
      const updated = await input.db
        .update(schema.session)
        .set({ operatorTotpVerifiedAt: verifiedAt, updatedAt: verifiedAt })
        .where(
          and(
            eq(schema.session.id, input.operatorSessionId),
            eq(schema.session.userId, input.operatorId)
          )
        )
        .returning({ id: schema.session.id })
      if (updated.length !== 1) throw challengeDenied()
    },
    catch: (error) =>
      error instanceof OperatorTotpPresenceDenied
        ? error
        : new CapabilityUnavailable({
            capability: 'operator-totp-presence',
            reason: 'operator TOTP verification is unavailable'
          })
  })

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
