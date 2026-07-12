import type {
  OnlinePaymentMethod,
  PaymentMethod,
  PaymentMethodEligibility
} from '@b2b-saas-starter/capabilities/payments'

const defaultLabels: Record<PaymentMethod, string> = {
  pay_in_person: 'Pay in person',
  card: 'Card',
  saved_card: 'Saved card',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  cash_app_pay: 'Cash App Pay',
  klarna: 'Buy now, pay later'
}

export type PaymentPresentationStatus = 'idle' | 'processing' | 'failed' | 'succeeded'

export function PaymentMethodSelector({
  eligibility,
  selected,
  status,
  onSelect,
  labels = defaultLabels,
  messages = {
    disabled: 'Online payment is unavailable. You can pay in person.',
    needs_configuration: 'Online payment is not configured. You can pay in person.',
    processing: 'Your payment is processing. Do not submit it again.',
    failed:
      'Your payment could not be completed. No successful collection was recorded.',
    succeeded: 'Payment complete.'
  }
}: {
  readonly eligibility: PaymentMethodEligibility
  readonly selected: PaymentMethod
  readonly status: PaymentPresentationStatus
  readonly onSelect: (method: PaymentMethod) => void
  readonly labels?: Record<PaymentMethod, string>
  readonly messages?: Record<
    | Exclude<PaymentMethodEligibility['state'], 'ready'>
    | Exclude<PaymentPresentationStatus, 'idle'>,
    string
  >
}) {
  const methods: readonly PaymentMethod[] = ['pay_in_person', ...eligibility.methods]
  const message =
    status !== 'idle'
      ? messages[status]
      : eligibility.state !== 'ready'
        ? messages[eligibility.state]
        : null
  return (
    <fieldset disabled={status === 'processing' || status === 'succeeded'}>
      <legend>Payment method</legend>
      {methods.map((method) => (
        <label key={method}>
          <input
            type="radio"
            name="payment-method"
            checked={selected === method}
            onChange={() => onSelect(method)}
          />
          {labels[method]}
        </label>
      ))}
      {message ? <output>{message}</output> : null}
    </fieldset>
  )
}

export const isOnlinePaymentMethod = (
  method: PaymentMethod
): method is OnlinePaymentMethod => method !== 'pay_in_person'
