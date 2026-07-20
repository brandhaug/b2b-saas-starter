import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb } from '@b2b-saas-starter/db/client'
import { auditEvents } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { eq } from 'drizzle-orm'
import {
  makeOperationsAbuseProtection,
  type OperationsAbuseBindings,
  type OperationsRateLimitCategory
} from './operations-abuse-protection.ts'

const fallbackLimits: Record<OperationsRateLimitCategory, number> = {
  'operator-session-read': 120,
  'operator-authentication': 10,
  'operator-totp': 5,
  'merchant-discovery': 30,
  'operator-management': 20,
  'impersonation-start': 10,
  'handoff-exchange': 10
}

describe('Operations authentication abuse protection adapter', () => {
  let testD1: TestD1

  beforeAll(async () => {
    testD1 = await provisionTestD1()
  }, 30_000)

  afterAll(async () => {
    await testD1?.dispose()
  })

  it('routes every Operations category to an independent opaque binding', async () => {
    const seen: Record<string, string[]> = {
      read: [],
      authentication: [],
      totp: [],
      search: [],
      management: [],
      impersonationStart: [],
      handoffExchange: []
    }
    const binding = (category: keyof typeof seen) => ({
      limit: vi.fn(async ({ key }: { readonly key: string }) => {
        seen[category]!.push(key)
        return { success: true }
      })
    })
    const protection = makeOperationsAbuseProtection({
      db: createDb(testD1.d1),
      bindings: {
        read: binding('read'),
        authentication: binding('authentication'),
        totp: binding('totp'),
        search: binding('search'),
        management: binding('management'),
        impersonationStart: binding('impersonationStart'),
        handoffExchange: binding('handoffExchange')
      },
      fallbackLimits,
      retryAfterSeconds: 60
    })
    const common = {
      subjectKey: 'operator@example.test',
      sourceKey: '203.0.113.7',
      operation: 'verify'
    } as const

    await protection.consume({ ...common, category: 'operator-session-read' })
    await protection.consume({ ...common, category: 'operator-authentication' })
    await protection.consume({ ...common, category: 'operator-totp' })
    await protection.consume({ ...common, category: 'merchant-discovery' })
    await protection.consume({ ...common, category: 'operator-management' })
    await protection.consume({ ...common, category: 'impersonation-start' })
    await protection.consume({ ...common, category: 'handoff-exchange' })

    expect(Object.values(seen).every((keys) => keys.length === 1)).toBe(true)
    expect(new Set(Object.values(seen).flat())).toHaveLength(7)
    expect(JSON.stringify(seen)).not.toContain('operator@example.test')
    expect(JSON.stringify(seen)).not.toContain('203.0.113.7')
  })

  it('durably deduplicates repeated denied-attempt evidence without raw identifiers', async () => {
    let allowed = false
    const denied = { limit: () => Promise.resolve({ success: allowed }) }
    const bindings: OperationsAbuseBindings = {
      authentication: denied
    }
    const protection = makeOperationsAbuseProtection({
      db: createDb(testD1.d1),
      bindings,
      fallbackLimits,
      retryAfterSeconds: 60,
      now: () => new Date('2026-07-19T10:00:00.000Z')
    })
    const request = {
      category: 'operator-authentication',
      subjectKey: 'sensitive-operator@example.test',
      sourceKey: '203.0.113.99',
      operation: 'password'
    } as const

    expect(await protection.consume(request)).toEqual({
      allowed: false,
      retryAfterSeconds: 60
    })
    await protection.consume(request)

    const rows = await createDb(testD1.d1)
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'operations.authentication.rate-limited'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorUserId: null,
      merchantId: null,
      targetType: 'system-operator-authentication',
      targetId: null
    })
    expect(JSON.stringify(rows[0])).not.toContain('sensitive-operator@example.test')
    expect(JSON.stringify(rows[0])).not.toContain('203.0.113.99')

    allowed = true
    expect(await protection.consume(request)).toEqual({
      allowed: true,
      retryAfterSeconds: null
    })
    expect(
      await createDb(testD1.d1)
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.eventType, 'operations.authentication.rate-limited'))
    ).toHaveLength(1)
  })
})
