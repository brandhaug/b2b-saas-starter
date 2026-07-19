import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  merchantMemberships,
  merchants,
  providerServiceEligibility,
  providers,
  publicBookingPages,
  scheduleRules,
  services,
  session,
  user
} from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { CapabilityUnavailable } from '../errors.ts'
import {
  OperationsContractDenied,
  OperationsDiscovery
} from './operations-contracts.ts'
import { makeOperationsDiscoveryLayer } from './operations-discovery.ts'

describe('Operations Merchant discovery', () => {
  let testD1: TestD1
  let db: ReturnType<typeof createDb>
  let activeSessionCreatedAt: Date

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    db = createDb(testD1.d1)
    const now = new Date()
    const later = new Date(now.getTime() + 8 * 60 * 60 * 1_000)
    activeSessionCreatedAt = new Date(
      Math.floor((now.getTime() - 30 * 60 * 1_000) / 1_000) * 1_000
    )
    await db.insert(user).values([
      {
        id: 'opr_reader',
        email: 'reader@operations.test',
        name: 'Merchant Reader',
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'merchant-reader',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'opr_auditor',
        email: 'auditor@operations.test',
        name: 'Auditor Only',
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'impersonation-auditor',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'mem_mara',
        email: 'mara@example.test',
        name: 'Mara Ionescu',
        emailVerified: true,
        identityClass: 'merchant_member',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'mem_disabled',
        email: 'disabled@example.test',
        name: 'Disabled Owner',
        emailVerified: true,
        identityClass: 'merchant_member',
        banned: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'cus_unsupported',
        email: 'customer@example.test',
        name: 'Unsupported Customer',
        emailVerified: true,
        identityClass: 'customer_account',
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(session).values([
      {
        id: 'ops_reader_session',
        token: 'ops-reader-token',
        userId: 'opr_reader',
        expiresAt: later,
        operatorIdleExpiresAt: later,
        operatorAbsoluteExpiresAt: later,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'ops_auditor_session',
        token: 'ops-auditor-token',
        userId: 'opr_auditor',
        expiresAt: later,
        operatorIdleExpiresAt: later,
        operatorAbsoluteExpiresAt: later,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'merchant_active_session',
        token: 'merchant-sensitive-session-token',
        userId: 'mem_mara',
        expiresAt: later,
        createdAt: activeSessionCreatedAt,
        updatedAt: now
      },
      {
        id: 'merchant_expired_session',
        token: 'merchant-expired-sensitive-token',
        userId: 'mem_mara',
        expiresAt: new Date(now.getTime() - 3 * 60 * 60 * 1_000),
        createdAt: new Date(now.getTime() - 22 * 60 * 60 * 1_000),
        updatedAt: now
      }
    ])
    await db.insert(merchants).values([
      {
        id: 'mer_mara',
        publicName: 'Mara Booking Studio',
        slug: 'mara-studio',
        timezone: 'Europe/Bucharest',
        currency: 'RON',
        plan: 'solo',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      },
      {
        id: 'mer_disabled',
        publicName: 'Quiet Studio',
        slug: 'quiet-studio',
        timezone: 'Europe/Bucharest',
        currency: 'RON',
        plan: 'solo',
        status: 'disabled',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      },
      {
        id: 'mer_unsupported',
        publicName: 'Unsupported Identity Studio',
        slug: 'unsupported-studio',
        timezone: 'Europe/Bucharest',
        currency: 'RON',
        plan: 'solo',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      }
    ])
    await db.insert(merchantMemberships).values([
      {
        merchantId: 'mer_mara',
        userId: 'mem_mara',
        role: 'owner',
        createdAt: now.toISOString()
      },
      {
        merchantId: 'mer_disabled',
        userId: 'mem_disabled',
        role: 'owner',
        createdAt: now.toISOString()
      },
      {
        merchantId: 'mer_unsupported',
        userId: 'cus_unsupported',
        role: 'owner',
        createdAt: now.toISOString()
      }
    ])
    await db.insert(publicBookingPages).values({
      id: 'pbp_mara',
      merchantId: 'mer_mara',
      status: 'published',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(providers).values({
      id: 'prv_mara',
      merchantId: 'mer_mara',
      linkedUserId: 'mem_mara',
      displayName: 'Mara',
      status: 'active',
      bookingAccess: 'public',
      isDefault: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(services).values({
      id: 'svc_mara',
      merchantId: 'mer_mara',
      name: 'Consultation',
      priceMinor: 10000,
      currency: 'RON',
      durationMinutes: 60,
      status: 'active',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(providerServiceEligibility).values({
      merchantId: 'mer_mara',
      providerId: 'prv_mara',
      serviceId: 'svc_mara',
      createdAt: now.toISOString()
    })
    await db.insert(scheduleRules).values({
      id: 'sch_mara',
      merchantId: 'mer_mara',
      providerId: 'prv_mara',
      weekday: 1,
      startTime: '09:00',
      endTime: '17:00',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
  }, 30_000)

  afterAll(async () => testD1?.dispose())

  const run = <A>(
    use: (
      discovery: OperationsDiscovery['Service']
    ) => Effect.Effect<A, OperationsContractDenied | CapabilityUnavailable>
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const discovery = yield* OperationsDiscovery
        return yield* use(discovery)
      }).pipe(Effect.provide(makeOperationsDiscoveryLayer(db)))
    )

  const actor = { operatorSessionId: 'ops_reader_session' } as const

  it('finds Merchants and Members by exact identifiers and partial text', async () => {
    const merchantsById = await run((discovery) =>
      discovery.search({ actor, kind: 'merchant', query: 'mer_mara', limit: 20 })
    )
    const merchantsByName = await run((discovery) =>
      discovery.search({ actor, kind: 'merchant', query: 'booking', limit: 20 })
    )
    const merchantsBySlug = await run((discovery) =>
      discovery.search({ actor, kind: 'merchant', query: 'mara-studio', limit: 20 })
    )
    const membersByEmail = await run((discovery) =>
      discovery.search({ actor, kind: 'merchant-member', query: 'mara@', limit: 20 })
    )
    const membersById = await run((discovery) =>
      discovery.search({
        actor,
        kind: 'merchant-member',
        query: 'mem_mara',
        limit: 20
      })
    )
    const membersByName = await run((discovery) =>
      discovery.search({ actor, kind: 'merchant-member', query: 'ionescu', limit: 20 })
    )

    expect(merchantsById).toEqual(merchantsByName)
    expect(merchantsById).toEqual(merchantsBySlug)
    expect(merchantsById).toEqual([
      {
        kind: 'merchant',
        id: 'mer_mara',
        publicName: 'Mara Booking Studio',
        slug: 'mara-studio',
        status: 'enabled'
      }
    ])
    expect(membersByEmail).toEqual([
      {
        kind: 'merchant-member',
        id: 'mem_mara',
        name: 'Mara Ionescu',
        email: 'mara@example.test',
        status: 'enabled',
        merchant: {
          id: 'mer_mara',
          publicName: 'Mara Booking Studio',
          role: 'owner'
        },
        impersonationEligible: true
      }
    ])
    expect(membersById).toEqual(membersByEmail)
    expect(membersByName).toEqual(membersByEmail)
  })

  it('returns minimal current Merchant and Member detail without credentials', async () => {
    const merchant = await run((discovery) =>
      discovery.getMerchant({ actor, merchantId: 'mer_mara' })
    )
    const member = await run((discovery) =>
      discovery.getMember({ actor, merchantId: 'mer_mara', memberId: 'mem_mara' })
    )

    expect(merchant).toMatchObject({
      id: 'mer_mara',
      status: 'enabled',
      publicPage: { status: 'published', bookingPath: '/mara-studio/booking' },
      readiness: { ready: true, incomplete: [] },
      members: [{ id: 'mem_mara', status: 'enabled', role: 'owner' }]
    })
    expect(member).toMatchObject({
      id: 'mem_mara',
      emailVerified: true,
      enabled: true,
      activeSessionCount: 1,
      lastSignInAt: activeSessionCreatedAt.toISOString(),
      membership: { merchantId: 'mer_mara', role: 'owner' },
      impersonationEligibility: { eligible: true, reason: null }
    })
    const serialized = JSON.stringify({ merchant, member })
    expect(serialized).not.toMatch(/token|password|secret|backup|customer/i)

    await expect(
      run((discovery) =>
        discovery.getMember({
          actor,
          merchantId: 'mer_mara',
          memberId: 'opr_auditor'
        })
      )
    ).rejects.toMatchObject({
      _tag: 'OperationsContractDenied',
      reason: 'merchant member not found'
    })
  })

  it('denies operators without merchant:read and bounds search inputs', async () => {
    const auditor = { operatorSessionId: 'ops_auditor_session' } as const
    await expect(
      run((discovery) =>
        discovery.search({
          actor: auditor,
          kind: 'merchant',
          query: 'mara',
          limit: 20
        })
      )
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })
    await expect(
      run((discovery) =>
        discovery.getMerchant({ actor: auditor, merchantId: 'mer_mara' })
      )
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })
    await expect(
      run((discovery) =>
        discovery.getMember({
          actor: auditor,
          merchantId: 'mer_mara',
          memberId: 'mem_mara'
        })
      )
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })
    await expect(
      run((discovery) =>
        discovery.search({ actor, kind: 'merchant', query: '   ', limit: 20 })
      )
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })
    await expect(
      run((discovery) =>
        discovery.search({ actor, kind: 'merchant', query: 'mara', limit: 51 })
      )
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })
  })

  it('shows disabled and mismatched targets as currently ineligible', async () => {
    const disabled = await run((discovery) =>
      discovery.getMember({
        actor,
        merchantId: 'mer_disabled',
        memberId: 'mem_disabled'
      })
    )
    const mismatch = await run((discovery) =>
      discovery.getMember({ actor, merchantId: 'mer_disabled', memberId: 'mem_mara' })
    )
    const unsupported = await run((discovery) =>
      discovery.getMember({
        actor,
        merchantId: 'mer_unsupported',
        memberId: 'cus_unsupported'
      })
    )

    expect(disabled.impersonationEligibility).toEqual({
      eligible: false,
      reason: 'member-disabled'
    })
    expect(mismatch.impersonationEligibility).toEqual({
      eligible: false,
      reason: 'merchant-membership-mismatch'
    })
    expect(unsupported.impersonationEligibility).toEqual({
      eligible: false,
      reason: 'unsupported-identity-class'
    })

    await db.update(user).set({ banned: true }).where(eq(user.id, 'mem_mara'))
    const staleTarget = await run((discovery) =>
      discovery.getMember({ actor, merchantId: 'mer_mara', memberId: 'mem_mara' })
    )
    expect(staleTarget.impersonationEligibility).toEqual({
      eligible: false,
      reason: 'member-disabled'
    })
  })
})
