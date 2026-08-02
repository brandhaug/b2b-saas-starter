import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import {
  batch,
  Database,
  merchantSubscriptionEvents,
  merchantSubscriptionNotices,
  merchantSubscriptionPriceEvidence,
  merchantSubscriptions,
  merchantSubscriptionUnmatchedEvents,
  merchantSubscriptionTrialClaims,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'

export const SOLO_PRICES = {
  monthly: { amountMinor: 1900, currency: 'EUR', excludesVat: true },
  annual: { amountMinor: 19000, currency: 'EUR', excludesVat: true }
} as const

export const subscriptionEvidenceFromProviderEvent = (input: {
  readonly merchantId?: string | undefined
  readonly eventId: string
  readonly eventType: string
  readonly occurredAt: string
  readonly providerCustomerRef?: string | undefined
  readonly providerSubscriptionRef?: string | undefined
  readonly periodEndsAt?: string | undefined
  readonly actualPriceId?: string | undefined
  readonly monthlyPriceId?: string | undefined
  readonly annualPriceId?: string | undefined
  readonly currency?: string | undefined
  readonly amount?: number | undefined
  readonly amountRefunded?: number | undefined
  readonly status?: string | undefined
  readonly cancelAtPeriodEnd?: boolean | undefined
}): SubscriptionEvidence | undefined => {
  if (!input.merchantId || !input.providerCustomerRef || !input.providerSubscriptionRef)
    return undefined
  const base = {
    merchantId: input.merchantId,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    providerCustomerRef: input.providerCustomerRef,
    providerSubscriptionRef: input.providerSubscriptionRef
  }
  if (input.eventType === 'checkout.session.completed')
    return { ...base, kind: 'billing-identity-recorded' }
  if (
    input.eventType === 'invoice.paid' ||
    input.eventType === 'invoice.payment_failed'
  ) {
    const priceId =
      input.actualPriceId === input.monthlyPriceId
        ? 'price_solo_monthly'
        : input.actualPriceId === input.annualPriceId
          ? 'price_solo_annual'
          : undefined
    return {
      ...base,
      kind:
        input.eventType === 'invoice.paid' ? 'invoice-paid' : 'invoice-payment-failed',
      periodEndsAt: input.periodEndsAt,
      priceId,
      amountMinor:
        priceId === 'price_solo_monthly'
          ? SOLO_PRICES.monthly.amountMinor
          : priceId === 'price_solo_annual'
            ? SOLO_PRICES.annual.amountMinor
            : undefined,
      currency: input.currency?.toUpperCase() === 'EUR' ? 'EUR' : undefined
    }
  }
  if (input.eventType === 'customer.subscription.deleted')
    return { ...base, kind: 'subscription-ended' }
  if (input.eventType === 'charge.dispute.created')
    return { ...base, kind: 'chargeback-opened' }
  if (input.eventType === 'charge.dispute.closed' && input.status === 'won')
    return { ...base, kind: 'chargeback-won' }
  if (input.eventType === 'charge.refunded') {
    if (
      input.amount !== undefined &&
      input.amountRefunded !== undefined &&
      input.amountRefunded === input.amount
    )
      return undefined
    return { ...base, kind: 'partial-refund' }
  }
  if (
    input.eventType === 'customer.subscription.updated' &&
    input.cancelAtPeriodEnd !== undefined
  )
    return {
      ...base,
      kind: input.cancelAtPeriodEnd
        ? 'subscription-cancel-scheduled'
        : 'subscription-cancel-reversed'
    }
  if (input.eventType === 'customer.subscription.updated' && input.actualPriceId) {
    const priceId =
      input.actualPriceId === input.monthlyPriceId
        ? 'price_solo_monthly'
        : input.actualPriceId === input.annualPriceId
          ? 'price_solo_annual'
          : undefined
    if (priceId)
      return {
        ...base,
        kind: 'interval-change-applied',
        periodEndsAt: input.periodEndsAt,
        priceId,
        amountMinor:
          priceId === 'price_solo_monthly'
            ? SOLO_PRICES.monthly.amountMinor
            : SOLO_PRICES.annual.amountMinor,
        currency: 'EUR'
      }
  }
  return undefined
}

export type BillingInterval = keyof typeof SOLO_PRICES
export type SubscriptionAccess = 'trialing' | 'active' | 'grace' | 'restricted'

export type MerchantSubscription = {
  readonly merchantId: string
  readonly ownerUserId: string
  readonly plan: 'solo'
  readonly interval: BillingInterval
  readonly access: SubscriptionAccess
  readonly price: (typeof SOLO_PRICES)[BillingInterval]
  readonly trialEndsAt: string
  readonly currentPeriodEndsAt?: string | undefined
  readonly graceEndsAt?: string | undefined
  readonly cancelAtPeriodEnd: boolean
  readonly providerCustomerRef?: string | undefined
  readonly providerSubscriptionRef?: string | undefined
  readonly restrictedAt?: string | undefined
  readonly retentionEndsAt?: string | undefined
  readonly revision: number
}

export type SubscriptionEvidence = {
  readonly merchantId: string
  readonly eventId: string
  readonly occurredAt: string
  readonly kind:
    | 'billing-identity-recorded'
    | 'invoice-paid'
    | 'invoice-payment-failed'
    | 'subscription-cancel-scheduled'
    | 'subscription-cancel-reversed'
    | 'interval-change-scheduled'
    | 'interval-change-applied'
    | 'subscription-ended'
    | 'chargeback-opened'
    | 'chargeback-won'
    | 'full-refund'
    | 'partial-refund'
  readonly providerCustomerRef: string
  readonly providerSubscriptionRef: string
  readonly periodEndsAt?: string | undefined
  readonly priceId?: string | undefined
  readonly amountMinor?: number | undefined
  readonly currency?: 'EUR' | undefined
  readonly refundConsequence?: 'end-access' | 'courtesy-preserve-access' | undefined
  readonly shortenedPeriodEndsAt?: string | undefined
}

export class SubscriptionDenied extends Schema.TaggedErrorClass<SubscriptionDenied>()(
  'SubscriptionDenied',
  {
    reason: Schema.Literals([
      'not_found',
      'person_already_used_trial',
      'idempotency_conflict',
      'unsupported_price',
      'refund_consequence_required',
      'billing_not_configured',
      'provider_unavailable',
      'invalid_state'
    ])
  }
) {}

export type SubscriptionNotice = {
  readonly merchantId: string
  readonly kind:
    | 'trial-7-days'
    | 'trial-3-days'
    | 'trial-1-day'
    | 'trial-expired'
    | 'grace-started'
    | 'grace-3-days'
    | 'grace-6-days'
    | 'restricted'
    | 'recovered'
    | 'paid-success'
    | 'scheduled-change'
    | 'scheduled-change-3-days'
    | 'scheduled-change-applied'
    | 'retention-30-days'
    | 'retention-7-days'
  readonly effectiveAt: string
  readonly cycleKey: string
}

export const subscriptionNoticeContent = (kind: SubscriptionNotice['kind']) => ({
  heading: kind.startsWith('trial')
    ? 'Your BeeSolo trial needs attention'
    : kind.startsWith('retention')
      ? 'Your BeeSolo data retention deadline is approaching'
      : kind === 'recovered' || kind === 'paid-success'
        ? 'Your BeeSolo subscription recovered'
        : 'Your BeeSolo subscription needs attention',
  message: `Subscription lifecycle notice: ${kind.replaceAll('-', ' ')}.`
})

export type MerchantSubscriptionsShape = {
  readonly startTrial: (input: {
    readonly merchantId: string
    readonly ownerUserId: string
    readonly interval: BillingInterval
    readonly idempotencyKey: string
    readonly now: string
  }) => Effect.Effect<MerchantSubscription, SubscriptionDenied | CapabilityUnavailable>
  readonly get: (
    merchantId: string
  ) => Effect.Effect<MerchantSubscription, SubscriptionDenied | CapabilityUnavailable>
  readonly recordEvidence: (
    evidence: SubscriptionEvidence
  ) => Effect.Effect<MerchantSubscription, SubscriptionDenied | CapabilityUnavailable>
  readonly reconcile: (
    evidence: SubscriptionEvidence
  ) => Effect.Effect<MerchantSubscription, SubscriptionDenied | CapabilityUnavailable>
  readonly recordSupportRefund: (
    evidence: SubscriptionEvidence &
      (
        | {
            readonly kind: 'full-refund'
            readonly refundConsequence: 'end-access' | 'courtesy-preserve-access'
          }
        | {
            readonly kind: 'partial-refund'
            readonly shortenedPeriodEndsAt?: string | undefined
          }
      )
  ) => Effect.Effect<MerchantSubscription, SubscriptionDenied | CapabilityUnavailable>
  readonly tick: (
    now: string
  ) => Effect.Effect<readonly SubscriptionNotice[], CapabilityUnavailable>
  readonly notices: (
    merchantId: string
  ) => Effect.Effect<readonly SubscriptionNotice[], CapabilityUnavailable>
  readonly providerBacked: () => Effect.Effect<
    readonly MerchantSubscription[],
    CapabilityUnavailable
  >
  readonly pendingNoticeDeliveries: (
    limit: number
  ) => Effect.Effect<
    readonly { readonly notice: SubscriptionNotice; readonly ownerEmail: string }[],
    CapabilityUnavailable
  >
  readonly acknowledgeNotice: (
    notice: SubscriptionNotice,
    now: string
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly retainUnmatchedEvent: (input: {
    readonly eventId: string
    readonly eventType: string
    readonly reason: string
    readonly receivedAt: string
  }) => Effect.Effect<void, CapabilityUnavailable>
}

export class MerchantSubscriptions extends Context.Service<
  MerchantSubscriptions,
  MerchantSubscriptionsShape
>()('@b2b-saas-starter/capabilities/MerchantSubscriptions') {}

export type SeedMerchantSubscriptionStore = {
  readonly subscriptions: Map<string, MerchantSubscription>
  readonly trialOwners: Set<string>
  readonly idempotency: Map<string, { fingerprint: string; merchantId: string }>
  readonly evidence: Map<string, SubscriptionEvidence>
  readonly priceEvidence: Array<{
    merchantId: string
    eventId: string
    priceId: string
    amountMinor: number
    currency: 'EUR'
    interval: BillingInterval
  }>
  readonly notices: Map<string, SubscriptionNotice>
}

export const emptySeedMerchantSubscriptionStore =
  (): SeedMerchantSubscriptionStore => ({
    subscriptions: new Map(),
    trialOwners: new Set(),
    idempotency: new Map(),
    evidence: new Map(),
    priceEvidence: [],
    notices: new Map()
  })

const plusDays = (instant: string, days: number) =>
  new Date(Date.parse(instant) + days * 86_400_000).toISOString()

export const createSoloTrialProjection = (input: {
  readonly merchantId: string
  readonly ownerUserId: string
  readonly interval: BillingInterval
  readonly now: string
}): MerchantSubscription => ({
  merchantId: input.merchantId,
  ownerUserId: input.ownerUserId,
  plan: 'solo',
  interval: input.interval,
  access: 'trialing',
  price: SOLO_PRICES[input.interval],
  trialEndsAt: plusDays(input.now, 14),
  cancelAtPeriodEnd: false,
  revision: 1
})

const priceInterval = (evidence: SubscriptionEvidence): BillingInterval | undefined => {
  if (
    evidence.priceId === 'price_solo_monthly' &&
    evidence.amountMinor === SOLO_PRICES.monthly.amountMinor &&
    evidence.currency === 'EUR'
  )
    return 'monthly'
  if (
    evidence.priceId === 'price_solo_annual' &&
    evidence.amountMinor === SOLO_PRICES.annual.amountMinor &&
    evidence.currency === 'EUR'
  )
    return 'annual'
  return undefined
}

const projectEvidence = (
  initial: MerchantSubscription,
  facts: readonly SubscriptionEvidence[]
): MerchantSubscription => {
  let value = initial
  for (const fact of [...facts].sort((a, b) =>
    a.occurredAt === b.occurredAt
      ? a.eventId.localeCompare(b.eventId)
      : a.occurredAt.localeCompare(b.occurredAt)
  )) {
    const common = {
      providerCustomerRef: fact.providerCustomerRef,
      providerSubscriptionRef: fact.providerSubscriptionRef,
      revision: value.revision + 1
    }
    switch (fact.kind) {
      case 'billing-identity-recorded':
        value = { ...value, ...common }
        break
      case 'invoice-paid': {
        const interval = priceInterval(fact)
        if (!interval || !fact.periodEndsAt) break
        value = {
          ...value,
          ...common,
          interval,
          price: SOLO_PRICES[interval],
          access: 'active',
          currentPeriodEndsAt: fact.periodEndsAt,
          graceEndsAt: undefined,
          restrictedAt: undefined,
          retentionEndsAt: undefined
        }
        break
      }
      case 'invoice-payment-failed':
        if (value.access === 'active')
          value = {
            ...value,
            ...common,
            access: 'grace',
            graceEndsAt: plusDays(fact.occurredAt, 7)
          }
        break
      case 'subscription-cancel-scheduled':
        value = { ...value, ...common, cancelAtPeriodEnd: true }
        break
      case 'subscription-cancel-reversed':
        value = { ...value, ...common, cancelAtPeriodEnd: false }
        break
      case 'interval-change-scheduled':
        value = { ...value, ...common }
        break
      case 'interval-change-applied': {
        const interval = priceInterval(fact)
        if (interval)
          value = {
            ...value,
            ...common,
            interval,
            price: SOLO_PRICES[interval],
            currentPeriodEndsAt: fact.periodEndsAt ?? value.currentPeriodEndsAt
          }
        break
      }
      case 'subscription-ended':
      case 'chargeback-opened':
        value = {
          ...value,
          ...common,
          access: 'restricted',
          restrictedAt: fact.occurredAt,
          retentionEndsAt: plusDays(fact.occurredAt, 365),
          cancelAtPeriodEnd: false
        }
        break
      case 'chargeback-won':
        if (value.currentPeriodEndsAt && value.currentPeriodEndsAt > fact.occurredAt)
          value = {
            ...value,
            ...common,
            access: 'active',
            restrictedAt: undefined,
            retentionEndsAt: undefined
          }
        break
      case 'full-refund':
        if (fact.refundConsequence === 'end-access')
          value = {
            ...value,
            ...common,
            access: 'restricted',
            restrictedAt: fact.occurredAt,
            retentionEndsAt: plusDays(fact.occurredAt, 365)
          }
        break
      case 'partial-refund':
        if (fact.shortenedPeriodEndsAt)
          value = {
            ...value,
            ...common,
            currentPeriodEndsAt: fact.shortenedPeriodEndsAt
          }
        break
    }
  }
  return value
}

export const SeedMerchantSubscriptions = (
  store: SeedMerchantSubscriptionStore
): Layer.Layer<MerchantSubscriptions> => {
  const service: MerchantSubscriptionsShape = {
    startTrial: (input) =>
      Effect.gen(function* () {
        const fingerprint = JSON.stringify(input)
        const replay = store.idempotency.get(input.idempotencyKey)
        if (replay) {
          if (replay.fingerprint !== fingerprint)
            return yield* Effect.fail(
              new SubscriptionDenied({ reason: 'idempotency_conflict' })
            )
          return store.subscriptions.get(replay.merchantId)!
        }
        if (store.trialOwners.has(input.ownerUserId))
          return yield* Effect.fail(
            new SubscriptionDenied({ reason: 'person_already_used_trial' })
          )
        const subscription = createSoloTrialProjection(input)
        store.subscriptions.set(input.merchantId, subscription)
        store.trialOwners.add(input.ownerUserId)
        store.idempotency.set(input.idempotencyKey, {
          fingerprint,
          merchantId: input.merchantId
        })
        return subscription
      }),
    get: (merchantId) => {
      const value = store.subscriptions.get(merchantId)
      return value
        ? Effect.succeed(value)
        : Effect.fail(new SubscriptionDenied({ reason: 'not_found' }))
    },
    recordEvidence: (fact) =>
      Effect.gen(function* () {
        const initial = store.subscriptions.get(fact.merchantId)
        if (!initial)
          return yield* Effect.fail(new SubscriptionDenied({ reason: 'not_found' }))
        if (fact.kind === 'full-refund' && !fact.refundConsequence)
          return yield* Effect.fail(
            new SubscriptionDenied({ reason: 'refund_consequence_required' })
          )
        const interval = fact.kind === 'invoice-paid' ? priceInterval(fact) : undefined
        if (fact.kind === 'invoice-paid' && !interval)
          return yield* Effect.fail(
            new SubscriptionDenied({ reason: 'unsupported_price' })
          )
        if (!store.evidence.has(fact.eventId)) {
          store.evidence.set(fact.eventId, fact)
          if (interval)
            store.priceEvidence.push({
              merchantId: fact.merchantId,
              eventId: fact.eventId,
              priceId: fact.priceId!,
              amountMinor: fact.amountMinor!,
              currency: fact.currency!,
              interval
            })
        }
        const projected = projectEvidence(
          initial,
          [...store.evidence.values()].filter(
            (item) => item.merchantId === fact.merchantId
          )
        )
        if (
          projected.access === 'active' &&
          (initial.access === 'grace' || initial.access === 'restricted')
        ) {
          const notice = {
            merchantId: fact.merchantId,
            kind: 'recovered' as const,
            effectiveAt: fact.occurredAt,
            cycleKey: fact.periodEndsAt ?? fact.eventId
          }
          store.notices.set(
            `${notice.merchantId}:${notice.kind}:${notice.cycleKey}`,
            notice
          )
        }
        const evidenceNoticeKind =
          fact.kind === 'invoice-paid'
            ? ('paid-success' as const)
            : fact.kind === 'invoice-payment-failed'
              ? ('grace-started' as const)
              : fact.kind === 'subscription-cancel-scheduled'
                ? ('scheduled-change' as const)
                : fact.kind === 'interval-change-scheduled'
                  ? ('scheduled-change' as const)
                  : fact.kind === 'interval-change-applied'
                    ? ('scheduled-change-applied' as const)
                    : fact.kind === 'subscription-ended' && initial.cancelAtPeriodEnd
                      ? ('scheduled-change-applied' as const)
                      : undefined
        if (evidenceNoticeKind) {
          const notice = {
            merchantId: fact.merchantId,
            kind: evidenceNoticeKind,
            effectiveAt: fact.occurredAt,
            cycleKey: fact.periodEndsAt ?? fact.eventId
          }
          store.notices.set(
            `${notice.merchantId}:${notice.kind}:${notice.cycleKey}`,
            notice
          )
        }
        store.subscriptions.set(fact.merchantId, projected)
        return projected
      }),
    reconcile: (fact) => service.recordEvidence(fact),
    recordSupportRefund: (fact) => service.recordEvidence(fact),
    notices: (merchantId) =>
      Effect.succeed(
        [...store.notices.values()].filter((notice) => notice.merchantId === merchantId)
      ),
    providerBacked: () =>
      Effect.succeed(
        [...store.subscriptions.values()].filter(
          (subscription) => subscription.providerSubscriptionRef
        )
      ),
    pendingNoticeDeliveries: () => Effect.succeed([]),
    acknowledgeNotice: () => Effect.void,
    retainUnmatchedEvent: () => Effect.void,
    tick: (now) =>
      Effect.sync(() => {
        const created: SubscriptionNotice[] = []
        const add = (notice: SubscriptionNotice) => {
          const key = `${notice.merchantId}:${notice.kind}:${notice.cycleKey}`
          if (!store.notices.has(key)) {
            store.notices.set(key, notice)
            created.push(notice)
          }
        }
        for (const [merchantId, current] of store.subscriptions) {
          let next = current
          if (current.access === 'trialing') {
            const days = Math.ceil(
              (Date.parse(current.trialEndsAt) - Date.parse(now)) / 86_400_000
            )
            if (days <= 7 && days > 3)
              add({
                merchantId,
                kind: 'trial-7-days',
                effectiveAt: now,
                cycleKey: current.trialEndsAt
              })
            if (days <= 3 && days > 1)
              add({
                merchantId,
                kind: 'trial-3-days',
                effectiveAt: now,
                cycleKey: current.trialEndsAt
              })
            if (days <= 1 && days > 0)
              add({
                merchantId,
                kind: 'trial-1-day',
                effectiveAt: now,
                cycleKey: current.trialEndsAt
              })
            if (days <= 0) {
              add({
                merchantId,
                kind: 'trial-expired',
                effectiveAt: now,
                cycleKey: current.trialEndsAt
              })
              add({
                merchantId,
                kind: 'restricted',
                effectiveAt: now,
                cycleKey: current.trialEndsAt
              })
              next = {
                ...current,
                access: 'restricted',
                restrictedAt: now,
                retentionEndsAt: plusDays(now, 365),
                revision: current.revision + 1
              }
            }
          } else if (current.access === 'grace' && current.graceEndsAt) {
            const remaining = Math.ceil(
              (Date.parse(current.graceEndsAt) - Date.parse(now)) / 86_400_000
            )
            const cycleKey = current.currentPeriodEndsAt ?? current.graceEndsAt
            if (remaining <= 7 && remaining > 4)
              add({ merchantId, kind: 'grace-started', effectiveAt: now, cycleKey })
            if (remaining <= 4 && remaining > 1)
              add({ merchantId, kind: 'grace-3-days', effectiveAt: now, cycleKey })
            if (remaining <= 1 && remaining > 0)
              add({ merchantId, kind: 'grace-6-days', effectiveAt: now, cycleKey })
          }
          if (
            current.cancelAtPeriodEnd &&
            current.currentPeriodEndsAt &&
            Date.parse(current.currentPeriodEndsAt) - Date.parse(now) <=
              3 * 86_400_000 &&
            Date.parse(current.currentPeriodEndsAt) > Date.parse(now)
          )
            add({
              merchantId,
              kind: 'scheduled-change-3-days',
              effectiveAt: now,
              cycleKey: current.currentPeriodEndsAt
            })
          if (next.access === 'restricted' && next.retentionEndsAt) {
            const days = Math.ceil(
              (Date.parse(next.retentionEndsAt) - Date.parse(now)) / 86_400_000
            )
            if (days <= 30 && days > 7)
              add({
                merchantId,
                kind: 'retention-30-days',
                effectiveAt: now,
                cycleKey: next.retentionEndsAt
              })
            if (days <= 7 && days >= 0)
              add({
                merchantId,
                kind: 'retention-7-days',
                effectiveAt: now,
                cycleKey: next.retentionEndsAt
              })
          }
          store.subscriptions.set(merchantId, next)
        }
        return created
      })
  }
  return Layer.succeed(MerchantSubscriptions)(service)
}

const fromRow = (
  row: typeof merchantSubscriptions.$inferSelect
): MerchantSubscription => ({
  merchantId: row.merchantId,
  ownerUserId: row.ownerUserId ?? '',
  plan: 'solo',
  interval: row.interval,
  access: row.status === 'cancelled' ? 'restricted' : row.status,
  price: SOLO_PRICES[row.interval],
  trialEndsAt: row.trialEndsAt ?? row.createdAt,
  ...(row.currentPeriodEndsAt ? { currentPeriodEndsAt: row.currentPeriodEndsAt } : {}),
  ...(row.graceEndsAt ? { graceEndsAt: row.graceEndsAt } : {}),
  ...(row.providerCustomerRef ? { providerCustomerRef: row.providerCustomerRef } : {}),
  ...(row.providerSubscriptionRef
    ? { providerSubscriptionRef: row.providerSubscriptionRef }
    : {}),
  ...(row.restrictedAt ? { restrictedAt: row.restrictedAt } : {}),
  ...(row.retentionEndsAt ? { retentionEndsAt: row.retentionEndsAt } : {}),
  cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  revision: row.revision
})

const unavailable = (reason: unknown) =>
  new CapabilityUnavailable({
    capability: 'merchant-subscriptions',
    reason: reason instanceof Error ? reason.message : String(reason)
  })

const liveGet = (db: EffectDatabase, merchantId: string) =>
  orUnavailable('merchant-subscriptions')(
    db
      .select()
      .from(merchantSubscriptions)
      .where(eq(merchantSubscriptions.merchantId, merchantId))
      .limit(1)
  ).pipe(
    Effect.flatMap((rows) =>
      rows[0]
        ? Effect.succeed(fromRow(rows[0]))
        : Effect.fail(new SubscriptionDenied({ reason: 'not_found' }))
    )
  )

const makeLiveService = (db: EffectDatabase): MerchantSubscriptionsShape => {
  const recordEvidence: MerchantSubscriptionsShape['recordEvidence'] = (fact) =>
    Effect.gen(function* () {
      const current = yield* liveGet(db, fact.merchantId)
      if (fact.kind === 'full-refund' && !fact.refundConsequence)
        return yield* Effect.fail(
          new SubscriptionDenied({ reason: 'refund_consequence_required' })
        )
      const interval =
        fact.kind === 'invoice-paid' || fact.kind === 'interval-change-applied'
          ? priceInterval(fact)
          : undefined
      if (
        (fact.kind === 'invoice-paid' || fact.kind === 'interval-change-applied') &&
        !interval
      )
        return yield* Effect.fail(
          new SubscriptionDenied({ reason: 'unsupported_price' })
        )
      const duplicate = yield* orUnavailable('merchant-subscriptions')(
        db
          .select({ eventId: merchantSubscriptionEvents.eventId })
          .from(merchantSubscriptionEvents)
          .where(eq(merchantSubscriptionEvents.eventId, fact.eventId))
          .limit(1)
      )
      if (duplicate[0]) return yield* liveGet(db, fact.merchantId)
      const priorRows = yield* orUnavailable('merchant-subscriptions')(
        db
          .select({ evidenceJson: merchantSubscriptionEvents.evidenceJson })
          .from(merchantSubscriptionEvents)
          .where(eq(merchantSubscriptionEvents.merchantId, fact.merchantId))
      )
      const projected = projectEvidence(current, [
        ...priorRows.map((row) => JSON.parse(row.evidenceJson) as SubscriptionEvidence),
        fact
      ])
      const now = new Date().toISOString()
      const lifecycleNotice =
        projected.access === 'active' &&
        (current.access === 'grace' || current.access === 'restricted')
          ? {
              id: newCapabilityId('sno'),
              merchantId: fact.merchantId,
              kind: 'recovered',
              cycleKey: fact.periodEndsAt ?? fact.eventId,
              effectiveAt: fact.occurredAt,
              createdAt: now
            }
          : projected.access === 'restricted' && current.access !== 'restricted'
            ? {
                id: newCapabilityId('sno'),
                merchantId: fact.merchantId,
                kind: 'restricted',
                cycleKey: fact.eventId,
                effectiveAt: fact.occurredAt,
                createdAt: now
              }
            : fact.kind === 'invoice-paid'
              ? {
                  id: newCapabilityId('sno'),
                  merchantId: fact.merchantId,
                  kind: 'paid-success',
                  cycleKey: fact.periodEndsAt ?? fact.eventId,
                  effectiveAt: fact.occurredAt,
                  createdAt: now
                }
              : fact.kind === 'invoice-payment-failed'
                ? {
                    id: newCapabilityId('sno'),
                    merchantId: fact.merchantId,
                    kind: 'grace-started',
                    cycleKey: fact.periodEndsAt ?? fact.eventId,
                    effectiveAt: fact.occurredAt,
                    createdAt: now
                  }
                : fact.kind === 'subscription-cancel-scheduled'
                  ? {
                      id: newCapabilityId('sno'),
                      merchantId: fact.merchantId,
                      kind: 'scheduled-change',
                      cycleKey: fact.periodEndsAt ?? fact.eventId,
                      effectiveAt: fact.occurredAt,
                      createdAt: now
                    }
                  : fact.kind === 'interval-change-scheduled'
                    ? {
                        id: newCapabilityId('sno'),
                        merchantId: fact.merchantId,
                        kind: 'scheduled-change',
                        cycleKey: fact.periodEndsAt ?? fact.eventId,
                        effectiveAt: fact.occurredAt,
                        createdAt: now
                      }
                    : fact.kind === 'interval-change-applied'
                      ? {
                          id: newCapabilityId('sno'),
                          merchantId: fact.merchantId,
                          kind: 'scheduled-change-applied',
                          cycleKey: fact.periodEndsAt ?? fact.eventId,
                          effectiveAt: fact.occurredAt,
                          createdAt: now
                        }
                      : fact.kind === 'subscription-ended' && current.cancelAtPeriodEnd
                        ? {
                            id: newCapabilityId('sno'),
                            merchantId: fact.merchantId,
                            kind: 'scheduled-change-applied',
                            cycleKey: fact.periodEndsAt ?? fact.eventId,
                            effectiveAt: fact.occurredAt,
                            createdAt: now
                          }
                        : undefined
      const writes = [
        db
          .insert(merchantSubscriptionEvents)
          .values({
            eventId: fact.eventId,
            merchantId: fact.merchantId,
            kind: fact.kind,
            occurredAt: fact.occurredAt,
            evidenceJson: JSON.stringify(fact),
            receivedAt: now
          })
          .onConflictDoNothing(),
        ...(interval
          ? [
              db
                .insert(merchantSubscriptionPriceEvidence)
                .values({
                  id: newCapabilityId('spe'),
                  merchantId: fact.merchantId,
                  eventId: fact.eventId,
                  priceId: fact.priceId!,
                  interval,
                  amountMinor: fact.amountMinor!,
                  currency: 'EUR' as const,
                  excludesVat: true,
                  recordedAt: now
                })
                .onConflictDoNothing()
            ]
          : []),
        ...(lifecycleNotice
          ? [
              db
                .insert(merchantSubscriptionNotices)
                .values(lifecycleNotice)
                .onConflictDoNothing()
            ]
          : []),
        db
          .update(merchantSubscriptions)
          .set({
            status: projected.access,
            interval: projected.interval,
            providerCustomerRef: projected.providerCustomerRef,
            providerSubscriptionRef: projected.providerSubscriptionRef,
            currentPeriodEndsAt: projected.currentPeriodEndsAt,
            graceEndsAt: projected.graceEndsAt,
            restrictedAt: projected.restrictedAt,
            retentionEndsAt: projected.retentionEndsAt,
            cancelAtPeriodEnd: projected.cancelAtPeriodEnd,
            revision: projected.revision,
            updatedAt: now
          })
          .where(eq(merchantSubscriptions.merchantId, fact.merchantId))
      ] as const
      yield* batch(db, writes).pipe(Effect.mapError(unavailable))
      return projected
    })

  return {
    startTrial: (input) =>
      Effect.gen(function* () {
        const fingerprint = JSON.stringify(input)
        const replay = yield* orUnavailable('merchant-subscriptions')(
          db
            .select()
            .from(merchantSubscriptionTrialClaims)
            .where(
              eq(merchantSubscriptionTrialClaims.idempotencyKey, input.idempotencyKey)
            )
            .limit(1)
        )
        if (replay[0]) {
          if (replay[0].requestFingerprint !== fingerprint)
            return yield* Effect.fail(
              new SubscriptionDenied({ reason: 'idempotency_conflict' })
            )
          return yield* liveGet(db, replay[0].merchantId)
        }
        const existingOwner = yield* orUnavailable('merchant-subscriptions')(
          db
            .select()
            .from(merchantSubscriptionTrialClaims)
            .where(eq(merchantSubscriptionTrialClaims.ownerUserId, input.ownerUserId))
            .limit(1)
        )
        if (existingOwner[0])
          return yield* Effect.fail(
            new SubscriptionDenied({ reason: 'person_already_used_trial' })
          )
        const subscription = createSoloTrialProjection(input)
        const write = batch(db, [
          db.insert(merchantSubscriptions).values({
            id: newCapabilityId('sub'),
            merchantId: input.merchantId,
            ownerUserId: input.ownerUserId,
            plan: 'solo',
            interval: input.interval,
            status: 'trialing',
            trialEndsAt: subscription.trialEndsAt,
            createdAt: input.now,
            updatedAt: input.now
          }),
          db.insert(merchantSubscriptionTrialClaims).values({
            ownerUserId: input.ownerUserId,
            merchantId: input.merchantId,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            claimedAt: input.now
          })
        ]).pipe(Effect.mapError(unavailable))
        yield* write.pipe(
          Effect.catch((failure) =>
            Effect.gen(function* () {
              const claims = yield* orUnavailable('merchant-subscriptions')(
                db
                  .select()
                  .from(merchantSubscriptionTrialClaims)
                  .where(
                    eq(merchantSubscriptionTrialClaims.ownerUserId, input.ownerUserId)
                  )
                  .limit(1)
              )
              const claim = claims[0]
              if (!claim) return yield* Effect.fail(failure)
              if (claim.idempotencyKey !== input.idempotencyKey)
                return yield* Effect.fail(
                  new SubscriptionDenied({ reason: 'person_already_used_trial' })
                )
              if (claim.requestFingerprint !== fingerprint)
                return yield* Effect.fail(
                  new SubscriptionDenied({ reason: 'idempotency_conflict' })
                )
              yield* liveGet(db, claim.merchantId)
            })
          )
        )
        return subscription
      }),
    get: (merchantId) => liveGet(db, merchantId),
    recordEvidence,
    reconcile: recordEvidence,
    recordSupportRefund: recordEvidence,
    notices: (merchantId) =>
      orUnavailable('merchant-subscriptions')(
        db
          .select({
            merchantId: merchantSubscriptionNotices.merchantId,
            kind: merchantSubscriptionNotices.kind,
            effectiveAt: merchantSubscriptionNotices.effectiveAt,
            cycleKey: merchantSubscriptionNotices.cycleKey
          })
          .from(merchantSubscriptionNotices)
          .where(eq(merchantSubscriptionNotices.merchantId, merchantId))
      ).pipe(Effect.map((rows) => rows as readonly SubscriptionNotice[])),
    tick: (now) =>
      Effect.gen(function* () {
        const rows = yield* orUnavailable('merchant-subscriptions')(
          db.select().from(merchantSubscriptions)
        )
        const notices: SubscriptionNotice[] = []
        for (const row of rows) {
          const current = fromRow(row)
          const memory = emptySeedMerchantSubscriptionStore()
          memory.subscriptions.set(current.merchantId, current)
          const created = yield* Effect.flatMap(MerchantSubscriptions, (service) =>
            service.tick(now)
          ).pipe(Effect.provide(SeedMerchantSubscriptions(memory)))
          const existingNotices = yield* orUnavailable('merchant-subscriptions')(
            db
              .select({
                kind: merchantSubscriptionNotices.kind,
                cycleKey: merchantSubscriptionNotices.cycleKey
              })
              .from(merchantSubscriptionNotices)
              .where(eq(merchantSubscriptionNotices.merchantId, current.merchantId))
          )
          const noticesToCreate = created.filter(
            (notice) =>
              !existingNotices.some(
                (existing) =>
                  existing.kind === notice.kind && existing.cycleKey === notice.cycleKey
              )
          )
          const next = memory.subscriptions.get(current.merchantId)!
          const writes = [
            ...noticesToCreate.map((notice) =>
              db
                .insert(merchantSubscriptionNotices)
                .values({
                  id: newCapabilityId('sno'),
                  merchantId: notice.merchantId,
                  kind: notice.kind,
                  cycleKey: notice.cycleKey,
                  effectiveAt: notice.effectiveAt,
                  createdAt: now
                })
                .onConflictDoNothing()
            ),
            db
              .update(merchantSubscriptions)
              .set({
                status: next.access,
                restrictedAt: next.restrictedAt,
                retentionEndsAt: next.retentionEndsAt,
                revision: next.revision,
                updatedAt: now
              })
              .where(eq(merchantSubscriptions.merchantId, current.merchantId))
          ]
          yield* batch(db, writes).pipe(Effect.mapError(unavailable))
          notices.push(...noticesToCreate)
        }
        return notices
      }),
    providerBacked: () =>
      orUnavailable('merchant-subscriptions')(
        db.select().from(merchantSubscriptions)
      ).pipe(
        Effect.map((rows) =>
          rows
            .map(fromRow)
            .filter((subscription) => subscription.providerSubscriptionRef)
        )
      ),
    pendingNoticeDeliveries: (limit) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await db.$client.config.db
            .prepare(
              `SELECT msn.merchant_id, msn.kind, msn.cycle_key, msn.effective_at,
                      u.email AS owner_email
               FROM merchant_subscription_notices msn
               JOIN merchant_memberships mm
                 ON mm.merchant_id = msn.merchant_id AND mm.role = 'owner'
               JOIN user u ON u.id = mm.user_id AND u.email_verified = 1
               WHERE msn.acknowledged_at IS NULL
               ORDER BY msn.effective_at LIMIT ?`
            )
            .bind(Math.max(1, limit))
            .all<{
              merchant_id: string
              kind: SubscriptionNotice['kind']
              cycle_key: string
              effective_at: string
              owner_email: string
            }>()
          return rows.results.map((row) => ({
            notice: {
              merchantId: row.merchant_id,
              kind: row.kind,
              cycleKey: row.cycle_key,
              effectiveAt: row.effective_at
            },
            ownerEmail: row.owner_email
          }))
        },
        catch: unavailable
      }),
    acknowledgeNotice: (notice, now) =>
      Effect.tryPromise({
        try: async () => {
          await db.$client.config.db
            .prepare(
              `UPDATE merchant_subscription_notices SET acknowledged_at = ?
               WHERE merchant_id = ? AND kind = ? AND cycle_key = ?
                 AND acknowledged_at IS NULL`
            )
            .bind(now, notice.merchantId, notice.kind, notice.cycleKey)
            .run()
        },
        catch: unavailable
      }),
    retainUnmatchedEvent: (input) =>
      orUnavailable('merchant-subscriptions')(
        db
          .insert(merchantSubscriptionUnmatchedEvents)
          .values(input)
          .onConflictDoNothing()
      ).pipe(Effect.asVoid)
  }
}

export const LiveMerchantSubscriptions: Layer.Layer<
  MerchantSubscriptions,
  never,
  Database
> = Layer.effect(MerchantSubscriptions, Effect.map(Database, makeLiveService))
