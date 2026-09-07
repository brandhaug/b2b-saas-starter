import { DateTime, Effect, Option, Schema, Stream } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { type SubscriptionState } from './billing.ts'
import { type PaymentEvidence } from './billing-state.ts'
import {
  readStripeObject,
  StripeTimestamp,
  type StripeSubscriptionResponse
} from './stripe.ts'

const Invoice = Schema.Struct({
  id: Schema.String,
  created: StripeTimestamp,
  amount_paid: Schema.Int,
  customer: Schema.String,
  status: Schema.NullOr(Schema.String),
  parent: Schema.NullOr(
    Schema.Struct({
      subscription_details: Schema.NullOr(
        Schema.Struct({ subscription: Schema.String })
      )
    })
  ),
  status_transitions: Schema.Struct({ paid_at: Schema.NullOr(StripeTimestamp) })
})
const InvoiceList = Schema.Struct({
  data: Schema.Array(Invoice),
  has_more: Schema.Boolean
})
const FailureList = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      created: StripeTimestamp,
      type: Schema.String,
      data: Schema.Struct({ object: Schema.Struct({ id: Schema.String }) })
    })
  ),
  has_more: Schema.Boolean
})
function iso(seconds: number) {
  return DateTime.formatIso(DateTime.makeUnsafe(seconds * 1000))
}
function unavailable(reason: string) {
  return new CapabilityUnavailable({ capability: 'billing', reason })
}

/** Missed webhook failures are recovered from verified provider history. */
export const retrievePaymentEvidence = Effect.fn('Stripe.retrievePaymentEvidence')(
  function* (
    secretKey: string,
    subscription: StripeSubscriptionResponse,
    previous: SubscriptionState | null,
    now: string
  ): Effect.fn.Return<PaymentEvidence, CapabilityUnavailable> {
    function owns(invoice: typeof Invoice.Type) {
      return (
        invoice.customer === subscription.customer &&
        invoice.parent?.subscription_details?.subscription === subscription.id
      )
    }
    let prior: SubscriptionState | null = null
    if (previous?.subscriptionId === subscription.id) {
      prior = previous
    }
    const paid = yield* Stream.paginate(
      { cursor: '', page: 0 },
      Effect.fn('Stripe.paidInvoicePage')(function* ({ cursor, page }) {
        let after = ''
        if (cursor !== '') {
          after = `&starting_after=${encodeURIComponent(cursor)}`
        }
        const result = yield* readStripeObject(
          secretKey,
          `invoices?subscription=${encodeURIComponent(subscription.id)}&status=paid&limit=100${after}`,
          InvoiceList
        )
        if (result.data.some((invoice) => !owns(invoice))) {
          return yield* Effect.fail(unavailable('invoice_ownership_mismatch'))
        }
        const next = result.data.at(-1)?.id
        if (result.has_more && (page >= 99 || next === undefined || next === cursor)) {
          return yield* Effect.fail(unavailable('payment_history_incomplete'))
        }
        let nextPage = Option.none<{ cursor: string; page: number }>()
        if (result.has_more && next !== undefined) {
          nextPage = Option.some({ cursor: next, page: page + 1 })
        }
        return [result.data, nextPage] satisfies readonly [
          ReadonlyArray<typeof Invoice.Type>,
          Option.Option<{ cursor: string; page: number }>
        ]
      })
    ).pipe(Stream.runCollect)
    // Invoice creation order is unrelated to settlement order. Establish positive
    // history first, then include later credit-covered settlements by paid_at.
    let establishedAt = prior?.lastPaymentAt ?? null
    for (const invoice of paid) {
      const seconds = invoice.status_transitions.paid_at
      if (invoice.status === 'paid' && invoice.amount_paid > 0 && seconds !== null) {
        const at = iso(seconds)
        if (establishedAt === null || Date.parse(at) < Date.parse(establishedAt)) {
          establishedAt = at
        }
      }
    }
    let lastPaymentAt = prior?.lastPaymentAt ?? null
    if (establishedAt !== null) {
      for (const invoice of paid) {
        const seconds = invoice.status_transitions.paid_at
        if (invoice.status === 'paid' && seconds !== null) {
          const at = iso(seconds)
          if (
            Date.parse(at) >= Date.parse(establishedAt) &&
            (lastPaymentAt === null || Date.parse(at) > Date.parse(lastPaymentAt))
          ) {
            lastPaymentAt = at
          }
        }
      }
    }
    let current: typeof Invoice.Type | null = null
    if (subscription.latest_invoice !== null) {
      current = yield* readStripeObject(
        secretKey,
        `invoices/${encodeURIComponent(subscription.latest_invoice)}`,
        Invoice
      )
    }
    if (current !== null && !owns(current)) {
      return yield* Effect.fail(unavailable('invoice_ownership_mismatch'))
    }
    const currentInvoicePaid =
      current?.status === 'paid' && current.status_transitions.paid_at !== null
    // A settled zero-due renewal preserves paying history. A trial's zero invoice establishes none.
    if (
      current?.status === 'paid' &&
      current.status_transitions.paid_at !== null &&
      (current.amount_paid > 0 || lastPaymentAt !== null)
    ) {
      const at = iso(current.status_transitions.paid_at)
      if (lastPaymentAt === null || Date.parse(at) > Date.parse(lastPaymentAt)) {
        lastPaymentAt = at
      }
    }
    let firstFailedAt = prior?.firstFailedAt ?? null
    if (
      firstFailedAt !== null &&
      lastPaymentAt !== null &&
      Date.parse(firstFailedAt) <= Date.parse(lastPaymentAt)
    ) {
      firstFailedAt = null
    }
    if (
      !currentInvoicePaid &&
      firstFailedAt === null &&
      current !== null &&
      (subscription.status === 'past_due' ||
        subscription.status === 'incomplete' ||
        subscription.status === 'unpaid')
    ) {
      // Older invoices cannot establish a fresh grace period from Stripe's 30-day event window.
      const oldest = Math.floor(Date.parse(now) / 1000) - 30 * 86_400
      if (current.created >= oldest) {
        let cursor: string | null = null
        let paidSince = 0
        if (lastPaymentAt !== null) {
          paidSince = Math.floor(Date.parse(lastPaymentAt) / 1000)
        }
        const since = Math.max(oldest, current.created, paidSince)
        for (let page = 0; page < 10; page += 1) {
          let after = ''
          if (cursor !== null) {
            after = `&starting_after=${encodeURIComponent(cursor)}`
          }
          const failures: typeof FailureList.Type = yield* readStripeObject(
            secretKey,
            `events?type=invoice.payment_failed&created[gte]=${since}&limit=100${after}`,
            FailureList
          )
          for (const event of failures.data) {
            const at = iso(event.created)
            if (
              event.type === 'invoice.payment_failed' &&
              event.data.object.id === current.id &&
              (lastPaymentAt === null || Date.parse(at) > Date.parse(lastPaymentAt)) &&
              (firstFailedAt === null || Date.parse(at) < Date.parse(firstFailedAt))
            ) {
              firstFailedAt = at
            }
          }
          if (!failures.has_more) {
            break
          }
          cursor = failures.data.at(-1)?.id ?? null
          if (page === 9 || cursor === null) {
            return yield* Effect.fail(unavailable('payment_history_incomplete'))
          }
        }
      }
    }
    return { lastPaymentAt, firstFailedAt, currentInvoicePaid }
  }
)
