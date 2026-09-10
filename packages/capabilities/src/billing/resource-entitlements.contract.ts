import { AuditEventLog } from '../governance/audit-event-log.ts'
import { Effect, Array } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { type expect as VitestExpect } from 'vite-plus/test'
import { ApiTokenRegistry } from '../developer-platform/api-token-registry.ts'
import { WebhookEndpoints } from '../developer-platform/webhook-endpoints.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { Billing, type SubscriptionState } from '@b2b-saas-starter/billing/billing'
import { ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'

const RESOURCE_TRIAL_END = '2026-09-02T00:00:00.000Z'
const RESOURCE_BEFORE_EXPIRY = '2026-09-01T00:00:00.000Z'

export const resourceDeadlineCases = [
  { name: 'trial expiry', state: { status: 'trialing', trialEnd: RESOURCE_TRIAL_END } },
  {
    name: 'renewal grace expiry',
    state: {
      status: 'past_due',
      firstFailedAt: '2026-08-26T00:00:00.000Z',
      graceEndsAt: RESOURCE_TRIAL_END,
      lastPaymentAt: '2026-08-01T00:00:00.000Z'
    }
  },
  {
    name: 'scheduled cancellation expiry',
    state: {
      status: 'active',
      paymentVerified: true,
      lastPaymentAt: '2026-08-01T00:00:00.000Z',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: RESOURCE_TRIAL_END
    }
  }
] satisfies ReadonlyArray<{
  readonly name: string
  readonly state: Partial<SubscriptionState>
}>

export function resourceEntitlementsContract(expect: typeof VitestExpect) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(RESOURCE_BEFORE_EXPIRY))
    const tokens = yield* ApiTokenRegistry
    const endpoints = yield* WebhookEndpoints
    const entitlements = yield* ResourceEntitlements
    const billing = yield* Billing
    const audit = yield* AuditEventLog
    const ctx = yield* WorkspaceContext
    const created = yield* Effect.forEach([1, 2, 3], (id) =>
      tokens.create({
        name: `entitlement-${id}`,
        scopes: ['read'],
        expiresAt: '2026-09-03T00:00:00.000Z'
      })
    )
    const hooks = yield* Effect.forEach([1, 2], (id) =>
      endpoints.create({
        url: `https://example.com/hooks/${id}`,
        events: ['api_token.created']
      })
    )
    const a = Array.getUnsafe(created, 0)
    const b = Array.getUnsafe(created, 1)
    const c = Array.getUnsafe(created, 2)
    const first = Array.getUnsafe(hooks, 0)
    const second = Array.getUnsafe(hooks, 1)
    const firstSend = yield* endpoints.sendTestEvent({ endpointId: first.endpoint.id })
    const secondSend = yield* endpoints.sendTestEvent({
      endpointId: second.endpoint.id
    })
    yield* entitlements.select({
      apiTokenIds: [a.id, b.id],
      webhookEndpointIds: [first.endpoint.id]
    })
    expect((yield* entitlements.getSelection()).apiTokenIds).toEqual([a.id, b.id])
    expect(
      (yield* audit.list({ eventType: 'billing.resource_selection_updated' })).items
        .length
    ).toBeGreaterThan(0)
    yield* TestClock.setTime(Date.parse(RESOURCE_TRIAL_END))
    expect((yield* billing.currentPlan).id).toBe('starter')
    expect(
      failureTag(
        yield* Effect.exit(tokens.create({ name: 'expired', scopes: ['read'] }))
      )
    ).toBe('PlanLimitExceeded')
    expect(
      failureTag(
        yield* Effect.exit(
          endpoints.create({ url: 'https://example.com/expired', events: [] })
        )
      )
    ).toBe('PlanLimitExceeded')
    yield* tokens.verifyBearerToken(a.token)
    expect(failureTag(yield* Effect.exit(tokens.verifyBearerToken(c.token)))).toBe(
      'AuthorizationDenied'
    )
    // A queued delivery retains its identity; dispatch re-reads authority.
    expect(
      yield* endpoints.getDispatchTarget(
        first.endpoint.id,
        ctx.workspace.id,
        firstSend.deliveryId
      )
    ).not.toBeNull()
    expect(
      yield* endpoints.getDispatchTarget(
        second.endpoint.id,
        ctx.workspace.id,
        secondSend.deliveryId
      )
    ).toBeNull()
    const replacements = yield* Effect.all(
      [a, b].map((token) =>
        tokens.replace({ tokenId: token.id, scopes: ['read'], overlapSeconds: 60 })
      ),
      { concurrency: 'unbounded' }
    )
    expect(new Set((yield* entitlements.getSelection()).apiTokenIds)).toEqual(
      new Set(replacements.map((token) => token.id))
    )
    for (const token of replacements) {
      yield* tokens.verifyBearerToken(token.token)
    }
    const replacement = Array.getUnsafe(replacements, 0)
    yield* tokens.revoke({ tokenId: replacement.id })
    expect((yield* entitlements.getSelection()).apiTokenIds).not.toContain(
      replacement.id
    )
    yield* endpoints.update({ endpointId: first.endpoint.id, enabled: false })
    expect((yield* entitlements.getSelection()).webhookEndpointIds).toEqual([])
    // Disabled endpoints stop dispatching but remain stored and consume the
    // creation slot.
    expect(
      failureTag(
        yield* Effect.exit(
          endpoints.create({ url: 'https://example.com/disabled-slot', events: [] })
        )
      )
    ).toBe('PlanLimitExceeded')
    expect(
      yield* endpoints.getDispatchTarget(
        first.endpoint.id,
        ctx.workspace.id,
        firstSend.deliveryId
      )
    ).toBeNull()
    yield* endpoints.update({ endpointId: first.endpoint.id, enabled: true })
    expect(
      yield* endpoints.getDispatchTarget(
        first.endpoint.id,
        ctx.workspace.id,
        firstSend.deliveryId
      )
    ).not.toBeNull()
    yield* endpoints.delete({ endpointId: first.endpoint.id })
    expect((yield* entitlements.getSelection()).webhookEndpointIds).toEqual([])
    expect(
      failureTag(
        yield* Effect.exit(
          entitlements.select({
            apiTokenIds: ['foreign-token'],
            webhookEndpointIds: []
          })
        )
      )
    ).toBe('ResourceSelectionRejected')
    expect(
      failureTag(
        yield* Effect.exit(
          entitlements.select({
            apiTokenIds: [],
            webhookEndpointIds: ['foreign-endpoint']
          })
        )
      )
    ).toBe('ResourceSelectionRejected')
    const selected = yield* entitlements.select({
      apiTokenIds: [replacement.id, c.id],
      webhookEndpointIds: [second.endpoint.id]
    })
    expect(selected.apiTokenIds).toEqual([c.id])
    expect(selected.webhookEndpointIds).toEqual([second.endpoint.id])
    yield* tokens.verifyBearerToken(c.token)
    expect(
      yield* endpoints.getDispatchTarget(
        second.endpoint.id,
        ctx.workspace.id,
        secondSend.deliveryId
      )
    ).not.toBeNull()
    yield* TestClock.setTime(Date.parse('2026-09-03T00:00:00.000Z'))
    expect((yield* entitlements.getSelection()).apiTokenIds).toEqual([])
    expect(failureTag(yield* Effect.exit(tokens.verifyBearerToken(c.token)))).toBe(
      'AuthorizationDenied'
    )
    expect(yield* entitlements.getSelectionForWorkspace('foreign-workspace')).toEqual({
      apiTokenIds: [],
      webhookEndpointIds: []
    })
  })
}

/** Admission-only contract against an empty Starter workspace. */
export function resourceAdmissionContract(expect: typeof VitestExpect) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse('2026-09-01T00:00:00.000Z'))
    const tokens = yield* ApiTokenRegistry
    const endpoints = yield* WebhookEndpoints
    const a = yield* tokens.create({
      name: 'expires',
      scopes: ['read'],
      expiresAt: '2026-09-03T00:00:00.000Z'
    })
    const b = yield* tokens.create({ name: 'replace-me', scopes: ['read'] })
    expect(
      failureTag(yield* Effect.exit(tokens.create({ name: 'full', scopes: ['read'] })))
    ).toBe('PlanLimitExceeded')

    yield* tokens.revoke({ tokenId: a.id })
    const c = yield* tokens.create({ name: 'after-revoke', scopes: ['read'] })
    const replacement = yield* tokens.replace({
      tokenId: b.id,
      scopes: ['read'],
      overlapSeconds: 60
    })
    expect(
      failureTag(
        yield* Effect.exit(tokens.create({ name: 'rotated-full', scopes: ['read'] }))
      )
    ).toBe('PlanLimitExceeded')
    yield* tokens.revoke({ tokenId: replacement.id })
    yield* tokens.create({ name: 'after-replacement-revoke', scopes: ['read'] })

    yield* tokens.revoke({ tokenId: c.id })
    const expiring = yield* tokens.create({
      name: 'expires-for-admission',
      scopes: ['read'],
      expiresAt: '2026-09-03T00:00:00.000Z'
    })
    expect(expiring.expiresAt).toBe('2026-09-03T00:00:00.000Z')
    expect(
      failureTag(
        yield* Effect.exit(tokens.create({ name: 'before-expiry', scopes: ['read'] }))
      )
    ).toBe('PlanLimitExceeded')
    yield* TestClock.setTime(Date.parse('2026-09-03T00:00:00.000Z'))
    yield* tokens.create({ name: 'after-expiry', scopes: ['read'] })

    const first = yield* endpoints.create({
      url: 'https://example.com/first',
      events: []
    })
    expect(
      failureTag(
        yield* Effect.exit(
          endpoints.create({ url: 'https://example.com/second', events: [] })
        )
      )
    ).toBe('PlanLimitExceeded')
    yield* endpoints.update({ endpointId: first.endpoint.id, enabled: false })
    expect(
      failureTag(
        yield* Effect.exit(
          endpoints.create({ url: 'https://example.com/disabled', events: [] })
        )
      )
    ).toBe('PlanLimitExceeded')
  })
}
