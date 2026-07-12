import type {
  OnlinePaymentMethod,
  PaymentMethod,
  PaymentMethodEligibility
} from '@b2b-saas-starter/capabilities/payments'

export type PaymentPresentationStatus = 'idle' | 'processing' | 'failed' | 'succeeded'

export function PaymentMethodSelector({
  eligibility,
  selected,
  status,
  onSelect,
  legend,
  labels,
  messages
}: {
  readonly eligibility: PaymentMethodEligibility
  readonly selected: PaymentMethod
  readonly status: PaymentPresentationStatus
  readonly onSelect: (method: PaymentMethod) => void
  readonly legend: string
  readonly labels: Record<PaymentMethod, string>
  readonly messages: Record<
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
    <fieldset disabled={status !== 'idle'}>
      <legend>{legend}</legend>
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
