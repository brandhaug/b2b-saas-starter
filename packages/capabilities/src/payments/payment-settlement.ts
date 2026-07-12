import { Context, Effect, Layer, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'

export const OnlinePaymentMethod = Schema.Literals([
  'card',
  'saved_card',
  'apple_pay',
  'google_pay',
  'cash_app_pay',
  'klarna'
])
export type OnlinePaymentMethod = typeof OnlinePaymentMethod.Type
export type PaymentMethod = OnlinePaymentMethod | 'pay_in_person'

export type PaymentConfiguration = {
  readonly provider: string
  readonly state: 'disabled' | 'needs_configuration' | 'configured'
  readonly methods: readonly OnlinePaymentMethod[]
}

export type PaymentMethodEligibility = {
  readonly state: 'disabled' | 'needs_configuration' | 'ready'
  readonly methods: readonly OnlinePaymentMethod[]
}

export const deriveEligiblePaymentMethods = (input: {
  readonly configuration: PaymentConfiguration
  readonly currency: string
  readonly amountMinor: number
  readonly savedMethodCount: number
  readonly wallets: {
    readonly applePay: boolean
    readonly googlePay: boolean
    readonly cashAppPay: boolean
  }
}): PaymentMethodEligibility => {
  if (input.configuration.state !== 'configured') {
    return { state: input.configuration.state, methods: [] }
  }
  const methods = input.configuration.methods.filter((method) => {
    if (method === 'saved_card') return input.savedMethodCount > 0
    if (method === 'apple_pay') return input.wallets.applePay
    if (method === 'google_pay') return input.wallets.googlePay
    if (method === 'cash_app_pay')
      return input.wallets.cashAppPay && input.currency === 'USD'
    if (method === 'klarna') {
      return ['USD', 'EUR', 'GBP'].includes(input.currency) && input.amountMinor >= 100
    }
    return true
  })
  return { state: 'ready', methods }
}

export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'partially_captured'
  | 'captured'
  | 'partially_refunded'
  | 'refunded'
  | 'cancelled'
export type MonetaryFact = {
  readonly kind: 'authorization' | 'capture' | 'refund' | 'void'
  readonly amountMinor: number
  readonly currency: string
  readonly providerReference: string
  readonly occurredAt: string
}
export type PaymentRecord = {
  readonly id: string
  readonly bookingPartyId: string
  readonly pricingQuoteId: string
  readonly amountMinor: number
  readonly currency: string
  readonly status: PaymentStatus
  readonly authorizedMinor: number
  readonly capturedMinor: number
  readonly refundedMinor: number
}
export type PaymentAttempt = {
  readonly id: string
  readonly paymentId: string
  readonly idempotencyKey: string
  readonly provider: string
  readonly method: OnlinePaymentMethod
  readonly outcome: 'pending' | 'succeeded' | 'failed'
  readonly providerReference: string | null
  readonly failureCode: string | null
}
export type PaymentView = {
  readonly payment: PaymentRecord
  readonly attempt: PaymentAttempt
}

export class PaymentSettlementConflict extends Schema.TaggedErrorClass<PaymentSettlementConflict>()(
  'PaymentSettlementConflict',
  { code: Schema.String }
) {}
export class PaymentAttemptNotFound extends Schema.TaggedErrorClass<PaymentAttemptNotFound>()(
  'PaymentAttemptNotFound',
  { attemptId: Schema.String }
) {}

type SettlementError =
  | PaymentSettlementConflict
  | PaymentAttemptNotFound
  | CapabilityUnavailable

export type PaymentSettlementShape = {
  readonly start: (input: {
    readonly bookingPartyId: string
    readonly pricingQuoteId: string
    readonly amountMinor: number
    readonly currency: string
    readonly method: OnlinePaymentMethod
    readonly provider: string
    readonly idempotencyKey: string
    readonly now: string
  }) => Effect.Effect<PaymentView, SettlementError>
  readonly recordAttemptOutcome: (input: {
    readonly attemptId: string
    readonly outcome: 'succeeded' | 'failed'
    readonly providerReference: string
    readonly failureCode?: string
    readonly facts: readonly MonetaryFact[]
    readonly now: string
  }) => Effect.Effect<PaymentView, SettlementError>
  readonly reconcile: (input: {
    readonly paymentId: string
    readonly provider: string
    readonly providerEventId: string
    readonly facts: readonly MonetaryFact[]
    readonly now: string
  }) => Effect.Effect<PaymentView, SettlementError>
  readonly choosePayInPerson: (input: {
    readonly bookingPartyId: string
    readonly amountMinor: number
    readonly currency: string
  }) => Effect.Effect<{
    readonly tender: 'pay_in_person'
    readonly amountMinor: number
    readonly currency: string
  }>
}

export class PaymentSettlement extends Context.Service<
  PaymentSettlement,
  PaymentSettlementShape
>()('@b2b-saas-starter/capabilities/PaymentSettlement') {}

export type SeedPaymentSettlementStore = {
  readonly payments: Map<string, PaymentRecord>
  readonly attempts: Map<string, PaymentAttempt>
  readonly attemptsByKey: Map<string, string>
  readonly facts: Map<string, MonetaryFact & { readonly paymentId: string }>
  readonly events: Set<string>
}
export const emptySeedPaymentSettlementStore = (): SeedPaymentSettlementStore => ({
  payments: new Map(),
  attempts: new Map(),
  attemptsByKey: new Map(),
  facts: new Map(),
  events: new Set()
})

const derivePayment = (
  payment: PaymentRecord,
  facts: Iterable<MonetaryFact & { readonly paymentId: string }>
): PaymentRecord => {
  let authorizedMinor = 0
  let capturedMinor = 0
  let refundedMinor = 0
  let voidedMinor = 0
  for (const fact of facts) {
    if (fact.paymentId !== payment.id) continue
    if (fact.kind === 'authorization') authorizedMinor += fact.amountMinor
    if (fact.kind === 'capture') capturedMinor += fact.amountMinor
    if (fact.kind === 'refund') refundedMinor += fact.amountMinor
    if (fact.kind === 'void') voidedMinor += fact.amountMinor
  }
  const status: PaymentStatus =
    capturedMinor > 0 && refundedMinor >= capturedMinor
      ? 'refunded'
      : refundedMinor > 0
        ? 'partially_refunded'
        : capturedMinor >= payment.amountMinor
          ? 'captured'
          : capturedMinor > 0
            ? 'partially_captured'
            : authorizedMinor > voidedMinor
              ? 'authorized'
              : voidedMinor > 0
                ? 'cancelled'
                : 'pending'
  return { ...payment, status, authorizedMinor, capturedMinor, refundedMinor }
}

export const SeedPaymentSettlement = (
  store = emptySeedPaymentSettlementStore()
): Layer.Layer<PaymentSettlement> =>
  Layer.succeed(PaymentSettlement)({
    start: (input) =>
      Effect.try({
        try: () => {
          const replayId = store.attemptsByKey.get(input.idempotencyKey)
          if (replayId) {
            const attempt = store.attempts.get(replayId)!
            return { payment: store.payments.get(attempt.paymentId)!, attempt }
          }
          const existingPayment = [...store.payments.values()].find(
            (payment) => payment.bookingPartyId === input.bookingPartyId
          )
          const payment: PaymentRecord = existingPayment ?? {
            id: `pay_${store.payments.size + 1}`,
            bookingPartyId: input.bookingPartyId,
            pricingQuoteId: input.pricingQuoteId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            status: 'pending',
            authorizedMinor: 0,
            capturedMinor: 0,
            refundedMinor: 0
          }
          if (
            payment.pricingQuoteId !== input.pricingQuoteId ||
            payment.amountMinor !== input.amountMinor ||
            payment.currency !== input.currency
          ) {
            throw new PaymentSettlementConflict({ code: 'payment_quote_mismatch' })
          }
          const attempt: PaymentAttempt = {
            id: `pat_${store.attempts.size + 1}`,
            paymentId: payment.id,
            idempotencyKey: input.idempotencyKey,
            provider: input.provider,
            method: input.method,
            outcome: 'pending',
            providerReference: null,
            failureCode: null
          }
          store.payments.set(payment.id, payment)
          store.attempts.set(attempt.id, attempt)
          store.attemptsByKey.set(input.idempotencyKey, attempt.id)
          return { payment, attempt }
        },
        catch: (cause) =>
          cause instanceof PaymentSettlementConflict
            ? cause
            : new PaymentSettlementConflict({ code: 'payment_start_failed' })
      }),
    recordAttemptOutcome: (input) => {
      const attempt = store.attempts.get(input.attemptId)
      if (!attempt)
        return Effect.fail(new PaymentAttemptNotFound({ attemptId: input.attemptId }))
      if (attempt.outcome !== 'pending') {
        return attempt.outcome === input.outcome &&
          attempt.providerReference === input.providerReference &&
          attempt.failureCode === (input.failureCode ?? null)
          ? Effect.succeed({
              payment: store.payments.get(attempt.paymentId)!,
              attempt
            })
          : Effect.fail(
              new PaymentSettlementConflict({ code: 'attempt_already_completed' })
            )
      }
      if (input.outcome === 'failed' && input.facts.length > 0)
        return Effect.fail(
          new PaymentSettlementConflict({ code: 'failed_attempt_has_facts' })
        )
      for (const fact of input.facts) {
        if (fact.currency !== store.payments.get(attempt.paymentId)!.currency) {
          return Effect.fail(
            new PaymentSettlementConflict({ code: 'fact_currency_mismatch' })
          )
        }
        store.facts.set(`${fact.kind}:${fact.providerReference}`, {
          ...fact,
          paymentId: attempt.paymentId
        })
      }
      const completed: PaymentAttempt = {
        ...attempt,
        outcome: input.outcome,
        providerReference: input.providerReference,
        failureCode: input.failureCode ?? null
      }
      store.attempts.set(attempt.id, completed)
      const payment = derivePayment(
        store.payments.get(attempt.paymentId)!,
        store.facts.values()
      )
      store.payments.set(payment.id, payment)
      return Effect.succeed({ payment, attempt: completed })
    },
    reconcile: (input) => {
      const payment = store.payments.get(input.paymentId)
      if (!payment)
        return Effect.fail(new PaymentSettlementConflict({ code: 'payment_not_found' }))
      if (!store.events.has(`${input.provider}:${input.providerEventId}`)) {
        for (const fact of input.facts) {
          store.facts.set(`${fact.kind}:${fact.providerReference}`, {
            ...fact,
            paymentId: payment.id
          })
        }
        store.events.add(`${input.provider}:${input.providerEventId}`)
      }
      const derived = derivePayment(payment, store.facts.values())
      store.payments.set(payment.id, derived)
      const attempt = [...store.attempts.values()].find(
        (row) => row.paymentId === payment.id
      )!
      return Effect.succeed({ payment: derived, attempt })
    },
    choosePayInPerson: (input) =>
      Effect.succeed({
        tender: 'pay_in_person',
        amountMinor: input.amountMinor,
        currency: input.currency
      })
  })
