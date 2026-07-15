import * as stylex from '@stylexjs/stylex'
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
  messages,
  allowPayInPerson = true,
  presentation = 'default'
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
  readonly allowPayInPerson?: boolean
  readonly presentation?: 'default' | 'legacyCheckout'
}) {
  const methods: readonly PaymentMethod[] = [
    ...(allowPayInPerson ? (['pay_in_person'] as const) : []),
    ...eligibility.methods
  ]
  const message =
    status !== 'idle'
      ? messages[status]
      : eligibility.state !== 'ready'
        ? messages[eligibility.state]
        : null
  if (presentation === 'legacyCheckout') {
    const visibleMethods = methods.includes(selected) ? [selected] : methods
    return (
      <div role="group" aria-label={legend} {...stylex.props(styles.legacyGroup)}>
        <p {...stylex.props(styles.legacyHeading)}>{legend}</p>
        {visibleMethods.map((method) => (
          <button
            key={method}
            type="button"
            data-testid={`button:paymentMethod:${method}`}
            aria-pressed={selected === method}
            onClick={() => onSelect(method)}
            {...stylex.props(styles.legacyMethod)}
          >
            <PaymentMethodIcon method={method} />
            <span {...stylex.props(styles.legacyLabel)}>{labels[method]}</span>
            <svg
              aria-hidden="true"
              width="7"
              height="12"
              viewBox="0 0 7 12"
              {...stylex.props(styles.legacyChevron)}
            >
              <path
                d="m1 1 5 5-5 5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
            </svg>
          </button>
        ))}
        {message ? (
          <output {...stylex.props(styles.legacyMessage)}>{message}</output>
        ) : null}
      </div>
    )
  }
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

function PaymentMethodIcon({ method }: { readonly method: PaymentMethod }) {
  if (method === 'pay_in_person')
    return (
      <svg aria-hidden="true" width="38" height="24" viewBox="0 0 38 24">
        <rect width="38" height="24" rx="3" fill="currentColor" />
        <path
          d="M14 10h10v7a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-7Zm-1 0 2.2-4h7.6L25 10"
          fill="none"
          stroke="#fff"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M17.5 14h3v4h-3z" fill="#fff" />
      </svg>
    )
  return (
    <svg aria-hidden="true" width="38" height="24" viewBox="0 0 38 24">
      <rect
        x=".75"
        y=".75"
        width="36.5"
        height="22.5"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M1 7h36" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

const styles = stylex.create({
  legacyGroup: {
    marginBlock: -4
  },
  legacyHeading: {
    margin: '4px 0 12px',
    color: '#1c1c1e',
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    letterSpacing: '-0.408px'
  },
  legacyMethod: {
    display: 'flex',
    width: '100%',
    height: 48,
    boxSizing: 'border-box',
    alignItems: 'center',
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: '#dadadc',
      '@media (hover: hover)': { default: '#dadadc', ':hover': '#e1e1e1' }
    },
    borderRadius: 8,
    backgroundColor: {
      default: '#f7f7f7',
      '@media (hover: hover)': { default: '#f7f7f7', ':hover': '#ffffff' }
    },
    boxShadow: {
      default: 'none',
      '@media (hover: hover)': {
        default: 'none',
        ':hover': '0 8px 16px -5px rgb(0 0 0 / 10%)'
      }
    },
    color: '#000000',
    cursor: 'pointer'
  },
  legacyLabel: {
    marginInline: 16,
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    letterSpacing: '-0.408px'
  },
  legacyChevron: {
    marginLeft: 'auto'
  },
  legacyMessage: {
    display: 'block',
    marginTop: 8,
    color: '#747983',
    fontSize: 12
  }
})

export const isOnlinePaymentMethod = (
  method: PaymentMethod
): method is OnlinePaymentMethod => method !== 'pay_in_person'
