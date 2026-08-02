import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import {
  batch,
  Database,
  merchantSubscriptionEvents,
  merchantSubscriptionNotices,
  merchantSubscriptionPriceEvidence,
  merchantSubscriptions,
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
    | 'invoice-paid'
    | 'invoice-payment-failed'
    | 'subscription-cancel-scheduled'
    | 'subscription-cancel-reversed'
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
      'billing_not_configured'
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
    | 'retention-30-days'
    | 'retention-7-days'
  readonly effectiveAt: string
}

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
  readonly tick: (
    now: string
  ) => Effect.Effect<readonly SubscriptionNotice[], CapabilityUnavailable>
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
        const subscription: MerchantSubscription = {
          merchantId: input.merchantId,
          ownerUserId: input.ownerUserId,
          plan: 'solo',
          interval: input.interval,
          access: 'trialing',
          price: SOLO_PRICES[input.interval],
          trialEndsAt: plusDays(input.now, 14),
          cancelAtPeriodEnd: false,
          revision: 1
        }
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
        store.subscriptions.set(fact.merchantId, projected)
        return projected
      }),
    reconcile: (fact) => service.recordEvidence(fact),
    tick: (now) =>
      Effect.sync(() => {
        const created: SubscriptionNotice[] = []
        const add = (notice: SubscriptionNotice) => {
          const key = `${notice.merchantId}:${notice.kind}`
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
              add({ merchantId, kind: 'trial-7-days', effectiveAt: now })
            if (days <= 3 && days > 1)
              add({ merchantId, kind: 'trial-3-days', effectiveAt: now })
            if (days <= 1 && days > 0)
              add({ merchantId, kind: 'trial-1-day', effectiveAt: now })
            if (days <= 0) {
              add({ merchantId, kind: 'trial-expired', effectiveAt: now })
              add({ merchantId, kind: 'restricted', effectiveAt: now })
              next = {
                ...current,
                access: 'restricted',
                restrictedAt: now,
                retentionEndsAt: plusDays(now, 365),
                revision: current.revision + 1
              }
            }
          } else if (
            current.access === 'grace' &&
            current.graceEndsAt &&
            current.graceEndsAt <= now
          ) {
            add({ merchantId, kind: 'restricted', effectiveAt: now })
            next = {
              ...current,
              access: 'restricted',
              restrictedAt: now,
              retentionEndsAt: plusDays(now, 365),
              revision: current.revision + 1
            }
          }
          if (next.access === 'restricted' && next.retentionEndsAt) {
            const days = Math.ceil(
              (Date.parse(next.retentionEndsAt) - Date.parse(now)) / 86_400_000
            )
            if (days <= 30 && days > 7)
              add({ merchantId, kind: 'retention-30-days', effectiveAt: now })
            if (days <= 7 && days >= 0)
              add({ merchantId, kind: 'retention-7-days', effectiveAt: now })
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
      const interval = fact.kind === 'invoice-paid' ? priceInterval(fact) : undefined
      if (fact.kind === 'invoice-paid' && !interval)
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
      const writes = [
        db.insert(merchantSubscriptionEvents).values({
          eventId: fact.eventId,
          merchantId: fact.merchantId,
          kind: fact.kind,
          occurredAt: fact.occurredAt,
          evidenceJson: JSON.stringify(fact),
          receivedAt: now
        }),
        ...(interval
          ? [
              db.insert(merchantSubscriptionPriceEvidence).values({
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
        const subscription: MerchantSubscription = {
          merchantId: input.merchantId,
          ownerUserId: input.ownerUserId,
          plan: 'solo',
          interval: input.interval,
          access: 'trialing',
          price: SOLO_PRICES[input.interval],
          trialEndsAt: plusDays(input.now, 14),
          cancelAtPeriodEnd: false,
          revision: 1
        }
        yield* batch(db, [
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
        return subscription
      }),
    get: (merchantId) => liveGet(db, merchantId),
    recordEvidence,
    reconcile: recordEvidence,
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
          const next = memory.subscriptions.get(current.merchantId)!
          const writes = [
            ...created.map((notice) =>
              db
                .insert(merchantSubscriptionNotices)
                .values({
                  id: newCapabilityId('sno'),
                  merchantId: notice.merchantId,
                  kind: notice.kind,
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
          notices.push(...created)
        }
        return notices
      })
  }
}

export const LiveMerchantSubscriptions: Layer.Layer<
  MerchantSubscriptions,
  never,
  Database
> = Layer.effect(MerchantSubscriptions, Effect.map(Database, makeLiveService))
