import { Effect, Layer } from 'effect'
import { and, eq, inArray } from 'drizzle-orm'
import {
  batch,
  bookingParties,
  Database,
  paymentAttempts,
  paymentReconciliationEvents,
  paymentTransactions,
  payments,
  pricingQuoteAcceptances,
  pricingQuotes
} from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { PaymentLedger, PaymentNotFound } from './index.ts'
import {
  PaymentAttemptNotFound,
  derivePaymentRecord,
  monetaryFactsAreValid,
  PaymentSettlement,
  PaymentSettlementConflict,
  type PaymentRecord,
  type PaymentView
} from './payment-settlement.ts'

export const SeedPaymentLedger = (
  records: readonly (typeof import('./index.ts').Payment.Type)[] = []
): Layer.Layer<PaymentLedger> =>
  Layer.succeed(PaymentLedger)({
    findById: (paymentId) => {
      const payment = records.find((record) => record.id === paymentId)
      return payment
        ? Effect.succeed(payment)
        : Effect.fail(new PaymentNotFound({ paymentId }))
    }
  })

export const LivePaymentLedger: Layer.Layer<PaymentLedger, never, Database> =
  Layer.effect(
    PaymentLedger,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        findById: (paymentId) =>
          Effect.flatMap(
            orUnavailable('payment-ledger')(
              db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
            ),
            ([payment]) =>
              payment
                ? Effect.succeed({
                    id: payment.id,
                    bookingPartyId: payment.bookingPartyId,
                    status: payment.status,
                    currency: payment.currency,
                    authorizedMinor: payment.authorizedMinor,
                    capturedMinor: payment.capturedMinor,
                    refundedMinor: payment.refundedMinor
                  })
                : Effect.fail(new PaymentNotFound({ paymentId }))
          )
      }
    })
  )

const stableSuffix = (value: string) => {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const recordFromRows = (
  payment: typeof payments.$inferSelect,
  facts: readonly (typeof paymentTransactions.$inferSelect)[]
): PaymentRecord => {
  return derivePaymentRecord(
    {
      id: payment.id,
      bookingPartyId: payment.bookingPartyId!,
      pricingQuoteId: payment.pricingQuoteId!,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      status: payment.status,
      authorizedMinor: payment.authorizedMinor,
      capturedMinor: payment.capturedMinor,
      refundedMinor: payment.refundedMinor
    },
    facts
  )
}

export const LivePaymentSettlement: Layer.Layer<PaymentSettlement, never, Database> =
  Layer.effect(
    PaymentSettlement,
    Effect.gen(function* () {
      const db = yield* Database
      const read = (
        paymentId: string,
        attemptId?: string
      ): Effect.Effect<
        PaymentView,
        | PaymentSettlementConflict
        | PaymentAttemptNotFound
        | import('../errors.ts').CapabilityUnavailable
      > =>
        Effect.gen(function* () {
          const [payment] = yield* orUnavailable('payment-settlement')(
            db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
          )
          if (!payment)
            return yield* new PaymentSettlementConflict({ code: 'payment_not_found' })
          const facts = yield* orUnavailable('payment-settlement')(
            db
              .select()
              .from(paymentTransactions)
              .where(eq(paymentTransactions.paymentId, paymentId))
          )
          const attempts = yield* orUnavailable('payment-settlement')(
            db
              .select()
              .from(paymentAttempts)
              .where(eq(paymentAttempts.paymentId, paymentId))
          )
          const attempt = attemptId
            ? attempts.find((candidate) => candidate.id === attemptId)
            : attempts.at(-1)
          if (!attempt)
            return yield* new PaymentAttemptNotFound({
              attemptId: attemptId ?? 'latest'
            })
          return {
            payment: recordFromRows(payment, facts),
            attempt: {
              id: attempt.id,
              paymentId: attempt.paymentId,
              idempotencyKey: attempt.idempotencyKey,
              provider: attempt.provider,
              method: attempt.method,
              outcome: attempt.outcome,
              providerReference: attempt.providerReference,
              failureCode: attempt.failureCode
            }
          }
        })
      return {
        findForParty: (bookingPartyId: string) =>
          Effect.gen(function* () {
            const [payment] = yield* orUnavailable('payment-settlement')(
              db
                .select()
                .from(payments)
                .where(eq(payments.bookingPartyId, bookingPartyId))
                .limit(1)
            )
            return payment ? yield* read(payment.id) : null
          }),
        settlementForConfirmation: (bookingPartyId: string) =>
          Effect.map(
            orUnavailable('payment-settlement')(
              db
                .select()
                .from(payments)
                .where(eq(payments.bookingPartyId, bookingPartyId))
                .limit(1)
            ),
            ([payment]) =>
              !payment
                ? ({ kind: 'pay_in_person' } as const)
                : payment.status === 'captured'
                  ? ({
                      kind: 'captured',
                      paymentId: payment.id,
                      amountMinor: payment.capturedMinor,
                      currency: payment.currency
                    } as const)
                  : ({ kind: 'processing', paymentId: payment.id } as const)
          ),
        start: (input) =>
          Effect.gen(function* () {
            const [replay] = yield* orUnavailable('payment-settlement')(
              db
                .select()
                .from(paymentAttempts)
                .where(eq(paymentAttempts.idempotencyKey, input.idempotencyKey))
                .limit(1)
            )
            if (replay) return yield* read(replay.paymentId, replay.id)
            const [quote] = yield* orUnavailable('payment-settlement')(
              db
                .select({ quote: pricingQuotes, acceptance: pricingQuoteAcceptances })
                .from(pricingQuotes)
                .innerJoin(
                  pricingQuoteAcceptances,
                  eq(pricingQuoteAcceptances.pricingQuoteId, pricingQuotes.id)
                )
                .where(eq(pricingQuotes.id, input.pricingQuoteId))
                .limit(1)
            )
            if (
              !quote ||
              quote.quote.bookingPartyId !== input.bookingPartyId ||
              quote.acceptance.partyVersion !== input.bookingPartyVersion ||
              quote.quote.totalMinor !== input.amountMinor ||
              quote.quote.currency !== input.currency ||
              quote.quote.expiresAt <= input.now
            )
              return yield* new PaymentSettlementConflict({
                code: 'quote_unconfirmable'
              })
            const [party] = yield* orUnavailable('payment-settlement')(
              db
                .select({ version: bookingParties.version })
                .from(bookingParties)
                .where(eq(bookingParties.id, input.bookingPartyId))
                .limit(1)
            )
            if (!party || party.version !== input.bookingPartyVersion)
              return yield* new PaymentSettlementConflict({
                code: 'quote_unconfirmable'
              })
            const paymentId = `pay_${stableSuffix(input.bookingPartyId)}`
            const attemptId = `pat_${stableSuffix(input.idempotencyKey)}`
            yield* orUnavailable('payment-settlement')(
              db
                .insert(payments)
                .values({
                  id: paymentId,
                  bookingPartyId: input.bookingPartyId,
                  pricingQuoteId: input.pricingQuoteId,
                  amountMinor: input.amountMinor,
                  currency: input.currency,
                  status: 'pending',
                  createdAt: input.now,
                  updatedAt: input.now
                })
                .onConflictDoNothing()
            )
            const [payment] = yield* orUnavailable('payment-settlement')(
              db
                .select()
                .from(payments)
                .where(eq(payments.bookingPartyId, input.bookingPartyId))
                .limit(1)
            )
            if (
              !payment ||
              payment.pricingQuoteId !== input.pricingQuoteId ||
              payment.amountMinor !== input.amountMinor ||
              payment.currency !== input.currency
            ) {
              return yield* new PaymentSettlementConflict({
                code: 'payment_quote_mismatch'
              })
            }
            const [activeAttempt] = yield* orUnavailable('payment-settlement')(
              db
                .select()
                .from(paymentAttempts)
                .where(
                  and(
                    eq(paymentAttempts.paymentId, payment.id),
                    inArray(paymentAttempts.outcome, ['pending', 'succeeded'])
                  )
                )
                .limit(1)
            )
            if (activeAttempt) return yield* read(payment.id, activeAttempt.id)
            yield* orUnavailable('payment-settlement')(
              db
                .insert(paymentAttempts)
                .values({
                  id: attemptId,
                  paymentId: payment.id,
                  idempotencyKey: input.idempotencyKey,
                  provider: input.provider,
                  method: input.method,
                  outcome: 'pending',
                  createdAt: input.now
                })
                .onConflictDoNothing()
            )
            return yield* read(payment.id, attemptId)
          }),
        recordAttemptOutcome: (input) =>
          Effect.gen(function* () {
            const [attempt] = yield* orUnavailable('payment-settlement')(
              db
                .select()
                .from(paymentAttempts)
                .where(eq(paymentAttempts.id, input.attemptId))
                .limit(1)
            )
            if (!attempt)
              return yield* new PaymentAttemptNotFound({ attemptId: input.attemptId })
            if (attempt.outcome !== 'pending') {
              if (
                attempt.outcome === input.outcome &&
                attempt.providerReference === input.providerReference &&
                attempt.failureCode === (input.failureCode ?? null)
              )
                return yield* read(attempt.paymentId, attempt.id)
              return yield* new PaymentSettlementConflict({
                code: 'attempt_already_completed'
              })
            }
            if (input.outcome === 'failed' && input.facts.length > 0)
              return yield* new PaymentSettlementConflict({
                code: 'failed_attempt_has_facts'
              })
            const [payment] = yield* orUnavailable('payment-settlement')(
              db
                .select()
                .from(payments)
                .where(eq(payments.id, attempt.paymentId))
                .limit(1)
            )
            if (input.facts.some((fact) => fact.currency !== payment!.currency)) {
              return yield* new PaymentSettlementConflict({
                code: 'fact_currency_mismatch'
              })
            }
            const existingFacts = yield* orUnavailable('payment-settlement')(
              db
                .select()
                .from(paymentTransactions)
                .where(eq(paymentTransactions.paymentId, attempt.paymentId))
            )
            if (
              !monetaryFactsAreValid(recordFromRows(payment!, existingFacts), [
                ...existingFacts,
                ...input.facts.map((fact) => ({
                  ...fact,
                  paymentId: attempt.paymentId
                }))
              ])
            )
              return yield* new PaymentSettlementConflict({
                code: 'invalid_monetary_facts'
              })
            yield* orUnavailable('payment-settlement')(
              batch(db, [
                ...input.facts.map((fact) =>
                  db
                    .insert(paymentTransactions)
                    .values({
                      id: `ptx_${stableSuffix(`${fact.kind}:${fact.providerReference}`)}`,
                      paymentId: attempt.paymentId,
                      ...fact,
                      createdAt: input.now
                    })
                    .onConflictDoNothing()
                ),
                db
                  .update(paymentAttempts)
                  .set({
                    outcome: input.outcome,
                    providerReference: input.providerReference,
                    failureCode: input.failureCode ?? null,
                    completedAt: input.now
                  })
                  .where(eq(paymentAttempts.id, input.attemptId))
              ])
            )
            const view = yield* read(attempt.paymentId, attempt.id)
            yield* orUnavailable('payment-settlement')(
              db
                .update(payments)
                .set({
                  status: view.payment.status,
                  authorizedMinor: view.payment.authorizedMinor,
                  capturedMinor: view.payment.capturedMinor,
                  refundedMinor: view.payment.refundedMinor,
                  updatedAt: input.now
                })
                .where(eq(payments.id, attempt.paymentId))
            )
            return view
          }),
        reconcile: (input) =>
          Effect.gen(function* () {
            const [replay] = yield* orUnavailable('payment-settlement')(
              db
                .select()
                .from(paymentReconciliationEvents)
                .where(
                  and(
                    eq(paymentReconciliationEvents.provider, input.provider),
                    eq(
                      paymentReconciliationEvents.providerEventId,
                      input.providerEventId
                    )
                  )
                )
                .limit(1)
            )
            if (replay) return yield* read(replay.paymentId)
            const [payment] = yield* orUnavailable('payment-settlement')(
              db
                .select()
                .from(payments)
                .where(eq(payments.id, input.paymentId))
                .limit(1)
            )
            if (!payment)
              return yield* new PaymentSettlementConflict({
                code: 'payment_not_found'
              })
            const existingFacts = yield* orUnavailable('payment-settlement')(
              db
                .select()
                .from(paymentTransactions)
                .where(eq(paymentTransactions.paymentId, input.paymentId))
            )
            if (
              !monetaryFactsAreValid(recordFromRows(payment, existingFacts), [
                ...existingFacts,
                ...input.facts.map((fact) => ({
                  ...fact,
                  paymentId: input.paymentId
                }))
              ])
            )
              return yield* new PaymentSettlementConflict({
                code: 'invalid_monetary_facts'
              })
            yield* orUnavailable('payment-settlement')(
              batch(db, [
                db
                  .insert(paymentReconciliationEvents)
                  .values({
                    id: `pre_${stableSuffix(`${input.provider}:${input.providerEventId}`)}`,
                    paymentId: input.paymentId,
                    provider: input.provider,
                    providerEventId: input.providerEventId,
                    receivedAt: input.now
                  })
                  .onConflictDoNothing(),
                ...input.facts.map((fact) =>
                  db
                    .insert(paymentTransactions)
                    .values({
                      id: `ptx_${stableSuffix(`${fact.kind}:${fact.providerReference}`)}`,
                      paymentId: input.paymentId,
                      ...fact,
                      createdAt: input.now
                    })
                    .onConflictDoNothing()
                )
              ])
            )
            const view = yield* read(input.paymentId)
            yield* orUnavailable('payment-settlement')(
              db
                .update(payments)
                .set({
                  status: view.payment.status,
                  authorizedMinor: view.payment.authorizedMinor,
                  capturedMinor: view.payment.capturedMinor,
                  refundedMinor: view.payment.refundedMinor,
                  updatedAt: input.now
                })
                .where(eq(payments.id, input.paymentId))
            )
            return view
          }),
        choosePayInPerson: (input) =>
          Effect.succeed({
            tender: 'pay_in_person' as const,
            amountMinor: input.amountMinor,
            currency: input.currency
          })
      }
    })
  )
