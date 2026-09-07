import { type StripeSubscriptionResponse } from './stripe.ts'

export const testPrice = {
  id: 'price_team',
  active: true,
  currency: 'usd',
  unit_amount: 1200,
  billing_scheme: 'per_unit',
  transform_quantity: null,
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }
}
export const testItem = {
  id: 'si_sync',
  quantity: 1,
  price: testPrice,
  current_period_start: 1_788_739_200,
  current_period_end: 1_791_417_600
}
export const testSubscriptionFields = {
  trial_end: null,
  cancel_at_period_end: false,
  latest_invoice: 'in_paid'
}
export function paidInvoice(
  subscription: Pick<StripeSubscriptionResponse, 'id' | 'customer'>
) {
  return {
    id: 'in_paid',
    created: 1_788_739_200,
    customer: subscription.customer,
    amount_paid: 1200,
    status: 'paid',
    parent: { subscription_details: { subscription: subscription.id } },
    status_transitions: { paid_at: 1_788_739_200 }
  }
}
