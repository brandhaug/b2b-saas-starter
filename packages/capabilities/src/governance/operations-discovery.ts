import { Effect, Layer } from 'effect'
import { asc, eq, sql } from 'drizzle-orm'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import {
  merchantMemberships,
  merchants,
  publicBookingPages,
  session,
  user
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { readBookingReadiness } from '../scheduling/scheduling.ts'
import {
  hasOperatorPermission,
  makeOperationsAuthorizationLayer,
  MerchantMemberDetail,
  OperationsAuthorization,
  OperationsContractDenied,
  OperationsDiscovery,
  type MerchantDiscoveryQuery,
  type OperatorSessionReference
} from './operations-contracts.ts'

const discoveryDenied = (reason: string) => new OperationsContractDenied({ reason })

const unavailable = (reason: string) =>
  new CapabilityUnavailable({ capability: 'operations-discovery', reason })

const discoveryError = (error: unknown, reason: string) =>
  error instanceof OperationsContractDenied || error instanceof CapabilityUnavailable
    ? error
    : unavailable(reason)

const authorizeDiscovery = async (
  db: PromiseDrizzleDatabase,
  reference: OperatorSessionReference
) => {
  const principal = await Effect.runPromise(
    Effect.gen(function* () {
      const authorization = yield* OperationsAuthorization
      return yield* authorization.authorize(reference)
    }).pipe(Effect.provide(makeOperationsAuthorizationLayer(db)))
  )
  if (!hasOperatorPermission(principal.roles, 'merchant:read')) {
    throw discoveryDenied('merchant:read is required')
  }
  return principal
}

const normalizeDiscoveryQuery = (input: MerchantDiscoveryQuery) => {
  const query = input.query.trim().toLocaleLowerCase('en-US')
  if (
    !query ||
    query.length > 100 ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 50
  ) {
    throw discoveryDenied('merchant discovery query is invalid')
  }
  return query
}

const includesText = (column: unknown, query: string) =>
  sql<boolean>`instr(lower(${column}), ${query}) > 0`

const memberEligibility = (input: {
  readonly identityClass: 'system_operator' | 'merchant_member' | 'customer_account'
  readonly banned: boolean | null
  readonly requestedMerchantId: string
  readonly memberMerchantId: string
  readonly merchantStatus: 'enabled' | 'disabled'
}): MerchantMemberDetail['impersonationEligibility'] => {
  if (input.identityClass !== 'merchant_member')
    return { eligible: false, reason: 'unsupported-identity-class' }
  if (input.banned) return { eligible: false, reason: 'member-disabled' }
  if (input.memberMerchantId !== input.requestedMerchantId)
    return { eligible: false, reason: 'merchant-membership-mismatch' }
  if (input.merchantStatus !== 'enabled')
    return { eligible: false, reason: 'merchant-disabled' }
  return { eligible: true, reason: null }
}

export const makeOperationsDiscoveryLayer = (
  db: PromiseDrizzleDatabase
): Layer.Layer<OperationsDiscovery> =>
  Layer.succeed(OperationsDiscovery)({
    search: (input) =>
      Effect.tryPromise({
        try: async () => {
          await authorizeDiscovery(db, input.actor)
          const query = normalizeDiscoveryQuery(input)
          if (input.kind === 'merchant') {
            return db
              .select({
                kind: sql<'merchant'>`'merchant'`,
                id: merchants.id,
                publicName: merchants.publicName,
                slug: merchants.slug,
                status: merchants.status
              })
              .from(merchants)
              .where(
                sql<boolean>`${merchants.id} = ${query} OR ${includesText(merchants.publicName, query)} OR ${includesText(merchants.slug, query)}`
              )
              .orderBy(asc(merchants.publicName), asc(merchants.id))
              .limit(input.limit)
          }
          const rows = await db
            .select({
              id: user.id,
              name: user.name,
              email: user.email,
              banned: user.banned,
              identityClass: user.identityClass,
              merchantId: merchants.id,
              merchantName: merchants.publicName,
              merchantStatus: merchants.status,
              role: merchantMemberships.role
            })
            .from(merchantMemberships)
            .innerJoin(user, eq(user.id, merchantMemberships.userId))
            .innerJoin(merchants, eq(merchants.id, merchantMemberships.merchantId))
            .where(
              sql<boolean>`${user.id} = ${query} OR ${includesText(user.name, query)} OR ${includesText(user.email, query)}`
            )
            .orderBy(asc(user.name), asc(user.id))
            .limit(input.limit)
          return rows.map((row) => ({
            kind: 'merchant-member' as const,
            id: row.id,
            name: row.name,
            email: row.email,
            status: row.banned ? ('disabled' as const) : ('enabled' as const),
            merchant: {
              id: row.merchantId,
              publicName: row.merchantName,
              role: row.role
            },
            impersonationEligible:
              row.identityClass === 'merchant_member' &&
              !row.banned &&
              row.merchantStatus === 'enabled'
          }))
        },
        catch: (error) => discoveryError(error, 'merchant search failed')
      }),
    getMerchant: (input) =>
      Effect.tryPromise({
        try: async () => {
          await authorizeDiscovery(db, input.actor)
          const [row] = await db
            .select({ merchant: merchants, pageStatus: publicBookingPages.status })
            .from(merchants)
            .leftJoin(
              publicBookingPages,
              eq(publicBookingPages.merchantId, merchants.id)
            )
            .where(eq(merchants.id, input.merchantId))
            .limit(1)
          if (!row) throw discoveryDenied('merchant not found')
          const members = await db
            .select({
              id: user.id,
              name: user.name,
              email: user.email,
              banned: user.banned,
              role: merchantMemberships.role
            })
            .from(merchantMemberships)
            .innerJoin(user, eq(user.id, merchantMemberships.userId))
            .where(eq(merchantMemberships.merchantId, input.merchantId))
            .orderBy(asc(user.name), asc(user.id))
          return {
            id: row.merchant.id,
            publicName: row.merchant.publicName,
            slug: row.merchant.slug,
            status: row.merchant.status,
            publicPage: {
              status: row.pageStatus ?? 'unpublished',
              bookingPath:
                row.pageStatus === 'published' ? `/${row.merchant.slug}/booking` : null
            },
            readiness: await readBookingReadiness(db, row.merchant.id),
            members: members.map((member) => ({
              id: member.id,
              name: member.name,
              email: member.email,
              status: member.banned ? ('disabled' as const) : ('enabled' as const),
              role: member.role
            }))
          }
        },
        catch: (error) => discoveryError(error, 'merchant detail read failed')
      }),
    getMember: (input) =>
      Effect.tryPromise({
        try: async () => {
          await authorizeDiscovery(db, input.actor)
          const [row] = await db
            .select({
              member: user,
              merchantId: merchantMemberships.merchantId,
              role: merchantMemberships.role,
              merchantName: merchants.publicName,
              merchantStatus: merchants.status
            })
            .from(user)
            .innerJoin(merchantMemberships, eq(merchantMemberships.userId, user.id))
            .innerJoin(merchants, eq(merchants.id, merchantMemberships.merchantId))
            .where(eq(user.id, input.memberId))
            .limit(1)
          if (!row) throw discoveryDenied('merchant member not found')
          const memberSessions = await db
            .select({ createdAt: session.createdAt, expiresAt: session.expiresAt })
            .from(session)
            .where(eq(session.userId, row.member.id))
          const now = new Date()
          const lastSignIn = memberSessions.reduce<Date | null>(
            (latest, current) =>
              !latest || current.createdAt > latest ? current.createdAt : latest,
            null
          )
          return {
            id: row.member.id,
            name: row.member.name,
            email: row.member.email,
            identityClass: row.member.identityClass,
            emailVerified: row.member.emailVerified,
            enabled: !row.member.banned,
            membership: {
              merchantId: row.merchantId,
              merchantName: row.merchantName,
              role: row.role
            },
            activeSessionCount: memberSessions.filter(
              (current) => current.expiresAt > now
            ).length,
            lastSignInAt: lastSignIn?.toISOString() ?? null,
            impersonationEligibility: memberEligibility({
              identityClass: row.member.identityClass,
              banned: row.member.banned,
              requestedMerchantId: input.merchantId,
              memberMerchantId: row.merchantId,
              merchantStatus: row.merchantStatus
            })
          }
        },
        catch: (error) => discoveryError(error, 'merchant member detail read failed')
      })
  })
