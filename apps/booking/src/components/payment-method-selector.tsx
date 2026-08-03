import * as stylex from '@stylexjs/stylex'
import type {
  OnlinePaymentMethod,
  PaymentMethod,
  PaymentMethodEligibility
} from '@b2b-saas-starter/capabilities/payments'
import { styles as bookingFlowStyles } from './booking-flow.styles.ts'

export type PaymentPresentationStatus = 'idle' | 'processing' | 'failed' | 'succeeded'

const legacyPaymentMethodOrder: readonly PaymentMethod[] = [
  'card',
  'cash_app_pay',
  'klarna',
  'apple_pay',
  'pay_in_person'
]

const legacyPaymentMethodPresentation = {
  card: { testId: 'btn:cardEntry', invertIcon: true, Icon: LegacyCardIcon },
  cash_app_pay: {
    testId: 'btn:cashApp',
    invertIcon: true,
    Icon: LegacyCashAppIcon
  },
  klarna: { testId: 'btn:bnpl', invertIcon: false, Icon: LegacyKlarnaIcon },
  apple_pay: {
    testId: 'btn:applePay',
    invertIcon: false,
    Icon: ApplePayCard
  },
  pay_in_person: {
    testId: 'btn:payInStore',
    invertIcon: true,
    Icon: LegacyInStoreIcon
  }
} as const

type LegacyPaymentMethod = keyof typeof legacyPaymentMethodPresentation

const isLegacyPaymentMethod = (method: PaymentMethod): method is LegacyPaymentMethod =>
  method in legacyPaymentMethodPresentation

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
    const visibleMethods = legacyPaymentMethodOrder.filter(
      (method): method is LegacyPaymentMethod =>
        methods.includes(method) && isLegacyPaymentMethod(method)
    )
    return (
      <>
        <p {...stylex.props(bookingFlowStyles.legacyCheckoutP1Bold)}>{legend}</p>
        <div
          data-testid="container:paymentMethodForm"
          {...stylex.props(styles.legacyMethods)}
        >
          {visibleMethods.map((method) => {
            const isSelected = selected === method
            const presentation = legacyPaymentMethodPresentation[method]
            const MethodIcon = presentation.Icon
            return (
              <button
                key={method}
                type="button"
                data-testid={presentation.testId}
                disabled={status !== 'idle'}
                onClick={() => onSelect(method)}
                {...stylex.props(
                  styles.legacyMethod,
                  isSelected && styles.legacyMethodSelected
                )}
              >
                <span
                  {...stylex.props(
                    styles.legacyIconSlot,
                    isSelected && presentation.invertIcon && styles.legacyIconSelected
                  )}
                >
                  <MethodIcon />
                </span>
                <span {...stylex.props(styles.legacyLabel)}>{labels[method]}</span>
              </button>
            )
          })}
        </div>
      </>
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

function LegacyCardIcon() {
  return <PaymentMethodIcon method="card" />
}

function LegacyCashAppIcon() {
  return <PaymentMethodIcon method="cash_app_pay" />
}

function LegacyKlarnaIcon() {
  return <PaymentMethodIcon method="klarna" />
}

function LegacyInStoreIcon() {
  return <PaymentMethodIcon method="pay_in_person" />
}

function PaymentMethodIcon({ method }: { readonly method: PaymentMethod }) {
  if (method === 'pay_in_person')
    return (
      <svg aria-hidden="true" width="38" height="24" viewBox="0 0 38 24">
        <rect width="38" height="24" rx="3" fill="black" />
        <path
          d="M22.8 6H15.2L13 9V10.5C13 11.3284 13.6716 12 14.5 12C15.3284 12 16 11.3284 16 10.5C16 11.3284 16.6716 12 17.5 12C18.3284 12 19 11.3284 19 10.5C19 11.3284 19.6716 12 20.5 12C21.3284 12 22 11.3284 22 10.5C22 11.3284 22.6716 12 23.5 12C24.3284 12 25 11.3284 25 10.5V9L22.8 6Z"
          fill="white"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M14 13.9655V17.0009C14 17.5532 14.4477 18.0009 15 18.0009H23C23.5523 18.0009 24 17.5532 24 17.0009V13.9655C23.8367 13.9888 23.6698 14.0009 23.5 14.0009C22.9632 14.0009 22.4546 13.88 22 13.6641C21.5454 13.88 21.0368 14.0009 20.5 14.0009C19.9632 14.0009 19.4546 13.88 19 13.6641C18.5454 13.88 18.0368 14.0009 17.5 14.0009C16.9632 14.0009 16.4546 13.88 16 13.6641C15.5454 13.88 15.0368 14.0009 14.5 14.0009C14.3302 14.0009 14.1633 13.9888 14 13.9655ZM20.5 15V18H17.5V15H20.5Z"
          fill="white"
        />
      </svg>
    )
  if (method === 'card')
    return (
      <svg aria-hidden="true" width="38" height="24" viewBox="0 0 38 24">
        <rect width="38" height="24" rx="3" fill="black" />
        <path
          d="M24.4695 6.6001H13.5306C12.5119 6.6001 12.0001 7.2577 12.0001 8.56027V9.14832H26V8.56027C26 7.2577 25.4931 6.6001 24.4695 6.6001ZM13.9937 15.4398C13.7061 15.4398 13.516 15.1869 13.516 14.8328V13.663C13.516 13.3026 13.7061 13.056 13.9937 13.056H15.1879C15.4755 13.056 15.6655 13.3026 15.6655 13.663V14.8328C15.6655 15.1869 15.4755 15.4398 15.1879 15.4398H13.9937ZM13.5306 17.4H24.4695C25.4931 17.4 26 16.7487 26 15.4462V10.5837H12.0001V15.4462C12.0001 16.7487 12.5119 17.4 13.5306 17.4Z"
          fill="white"
        />
      </svg>
    )
  if (method === 'cash_app_pay')
    return (
      <svg aria-hidden="true" width="38" height="24" viewBox="0 0 38 24">
        <rect width="38" height="24" rx="3" fill="#000" />
        <path
          d="M25.7611 7.02489C25.4601 6.19716 24.8087 5.54759 23.9813 5.24644C23.2179 5 22.5231 5 21.1125 5H16.8765C15.4774 5 14.7708 5 14.0191 5.23243C13.1896 5.53577 12.5381 6.19016 12.2393 7.01963C12 7.77864 12 8.47855 12 9.87838V14.1212C12 15.528 12 16.2231 12.2323 16.9821C12.5333 17.8098 13.1848 18.4594 14.0121 18.7606C14.7708 19 15.4704 19 16.8717 19H21.1169C22.5231 19 23.2227 19 23.9765 18.7676C24.806 18.4664 25.4601 17.8125 25.7607 16.9826C26 16.2235 26 15.5236 26 14.1216V9.8902C26 8.48337 26 7.78345 25.7607 7.02445L25.7611 7.02489ZM22.163 9.72868L21.6183 10.2714C21.5089 10.3717 21.3405 10.3739 21.2285 10.2758C20.7021 9.83373 20.0367 9.58948 19.3507 9.58729C18.7832 9.58729 18.2179 9.7742 18.2179 10.2942C18.2179 10.8186 18.8239 10.9941 19.5235 11.2563C20.7494 11.6669 21.7636 12.1795 21.7636 13.381C21.7636 14.6898 20.7494 15.588 19.093 15.686L18.9403 16.3881C18.9127 16.5203 18.7968 16.614 18.6625 16.614H17.6164L17.5639 16.6096C17.409 16.5755 17.311 16.4205 17.3429 16.2656L17.507 15.5245C16.8778 15.3674 16.2994 15.0505 15.8252 14.6079V14.6009C15.7158 14.4915 15.7158 14.3138 15.8252 14.2044L16.4084 13.6388C16.52 13.5364 16.691 13.5364 16.8004 13.6388C17.3315 14.1404 18.0425 14.4206 18.7784 14.4092C19.537 14.4092 20.0433 14.0879 20.0433 13.5793C20.0433 13.0707 19.5305 12.9385 18.5623 12.576C17.5345 12.2088 16.5615 11.6892 16.5615 10.4741C16.5615 9.06291 17.7327 8.37437 19.1227 8.31047L19.2684 7.59217C19.296 7.45998 19.4141 7.36631 19.5489 7.36893H20.5858L20.6448 7.37594C20.7953 7.41008 20.8955 7.55584 20.8614 7.7086L20.7043 8.50875C21.2285 8.68209 21.7251 8.95785 22.149 9.3181L22.1626 9.33167C22.2719 9.4481 22.2719 9.62362 22.1626 9.72824L22.163 9.72868Z"
          fill="#fff"
        />
      </svg>
    )
  if (method === 'klarna')
    return (
      <svg aria-hidden="true" width="38" height="25" viewBox="0 0 38 25">
        <path
          d="M0 4C0 1.79086 1.79086 0 4 0H34C36.2091 0 38 1.79086 38 4V21C38 23.2091 36.2091 25 34 25H4C1.79086 25 0 23.2091 0 21V4Z"
          fill="#0D0D0D"
        />
        <path
          d="M26 11.083V15.9453C26 17.2477 25.4931 17.8993 24.4697 17.8994H13.5303C12.5117 17.8993 12 17.2478 12 15.9453V11.083H26ZM13.9932 13.5557C13.7059 13.5559 13.5158 13.8021 13.5156 14.1621V15.332C13.5156 15.686 13.7058 15.9392 13.9932 15.9395H15.1875C15.4751 15.9395 15.665 15.6861 15.665 15.332V14.1621C15.6649 13.8019 15.475 13.5557 15.1875 13.5557H13.9932ZM24.4697 7.09961C25.493 7.09976 25.9999 7.75729 26 9.05957V9.64746H12V9.05957C12.0001 7.75725 12.5118 7.09971 13.5303 7.09961H24.4697Z"
          fill="white"
        />
        <circle cx="25" cy="15" r="5" fill="#0D0D0D" />
        <path
          d="M25 11C24.2089 11 23.4355 11.2346 22.7777 11.6741C22.1199 12.1136 21.6072 12.7384 21.3045 13.4693C21.0017 14.2002 20.9225 15.0044 21.0769 15.7804C21.2312 16.5563 21.6122 17.269 22.1716 17.8284C22.731 18.3878 23.4437 18.7688 24.2196 18.9231C24.9956 19.0775 25.7998 18.9983 26.5307 18.6955C27.2616 18.3928 27.8864 17.8801 28.3259 17.2223C28.7654 16.5645 29 15.7911 29 15C28.9989 13.9395 28.5771 12.9227 27.8272 12.1728C27.0773 11.4229 26.0605 11.0011 25 11ZM27.1538 15.3077H25C24.9184 15.3077 24.8401 15.2753 24.7824 15.2176C24.7247 15.1599 24.6923 15.0816 24.6923 15V12.8462C24.6923 12.7645 24.7247 12.6863 24.7824 12.6286C24.8401 12.5709 24.9184 12.5385 25 12.5385C25.0816 12.5385 25.1599 12.5709 25.2176 12.6286C25.2753 12.6863 25.3077 12.7645 25.3077 12.8462V14.6923H27.1538C27.2355 14.6923 27.3137 14.7247 27.3714 14.7824C27.4291 14.8401 27.4615 14.9184 27.4615 15C27.4615 15.0816 27.4291 15.1599 27.3714 15.2176C27.3137 15.2753 27.2355 15.3077 27.1538 15.3077Z"
          fill="white"
        />
      </svg>
    )
  if (method === 'apple_pay') return <ApplePayCard />
  return <svg aria-hidden="true" width="38" height="24" viewBox="0 0 38 24" />
}

function ApplePayCard() {
  return (
    <svg aria-hidden="true" width="38" height="24" viewBox="0 0 38 24">
      <rect width="38" height="24" rx="3.4" fill="black" />
      <rect x=".844" y=".828" width="36.312" height="22.344" rx="2.6" fill="white" />
      <path
        d="M10.407 8.1c.326-.395.547-.925.489-1.467-.478.023-1.061.305-1.398.7-.303.339-.572.891-.502 1.41.537.046 1.072-.259 1.41-.643Zm.483.745c-.779-.045-1.441.428-1.813.428s-.942-.405-1.558-.395c-.802.012-1.546.45-1.953 1.148-.837 1.396-.221 3.466.593 4.603.395.562.872 1.181 1.5 1.159.592-.023.825-.372 1.546-.372.72 0 .929.372 1.557.36.65-.01 1.058-.562 1.453-1.125.454-.64.64-1.26.651-1.294-.012-.011-1.255-.473-1.267-1.857-.012-1.159.977-1.71 1.023-1.744-.558-.798-1.43-.888-1.732-.911Z"
        fill="black"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20.544 10.05c0-1.644-1.179-2.773-2.872-2.773H14.4v8.44h1.355v-2.883h1.875c1.71 0 2.914-1.135 2.914-2.784Zm-3.235 1.684h-1.554V8.382h1.56c1.173 0 1.844.609 1.844 1.673 0 1.065-.671 1.679-1.85 1.679Zm5.953.415c-1.512.082-2.364.743-2.364 1.82 0 1.105.87 1.854 2.116 1.854.834 0 1.639-.433 2.007-1.117h.03v1.012h1.252v-4.241c0-1.235-.985-2.024-2.527-2.024-1.572 0-2.552.819-2.624 1.93h1.233c.115-.55.587-.9 1.343-.9.798 0 1.275.409 1.275 1.093v.474l-1.741.1Zm1.741.779v.485c0 .801-.713 1.41-1.626 1.41-.702 0-1.161-.351-1.161-.89 0-.526.441-.86 1.221-.912l1.566-.093Z"
        fill="black"
      />
      <path
        d="M27.485 17.982v-1.024c.096.023.314.023.423.023.604 0 .93-.245 1.13-.877 0-.012.115-.374.115-.38l-2.297-6.16h1.415l1.608 5.007h.024l1.609-5.007h1.378l-2.382 6.475c-.544 1.492-1.173 1.972-2.491 1.972-.109 0-.436-.012-.532-.03Z"
        fill="black"
      />
    </svg>
  )
}

const styles = stylex.create({
  legacyMethods: {
    display: 'flex',
    gap: 8,
    flexDirection: 'column',
    marginTop: 12,
    marginBottom: 4
  },
  legacyMethod: {
    display: 'flex',
    width: '100%',
    height: 48,
    boxSizing: 'border-box',
    alignItems: 'center',
    paddingTop: 0,
    paddingRight: 16,
    paddingBottom: 0,
    paddingLeft: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: '#dadadc',
      '@media (hover: hover)': { default: '#dadadc', ':hover': '#dadadc' }
    },
    borderRadius: 8,
    backgroundColor: {
      default: 'transparent',
      '@media (hover: hover)': { default: 'transparent', ':hover': '#ffffff' }
    },
    color: '#000000',
    boxShadow: {
      default: 'none',
      '@media (hover: hover)': {
        default: 'none',
        ':hover': '0 8px 16px -5px rgb(0 0 0 / 10%)'
      }
    },
    textAlign: 'left',
    cursor: 'pointer',
    touchAction: 'manipulation',
    transitionProperty: 'background-color, border-color, box-shadow',
    transitionDuration: '300ms',
    opacity: { default: 1, ':disabled': 0.6 }
  },
  legacyMethodSelected: {
    borderColor: {
      default: '#000000',
      '@media (hover: hover)': { default: '#000000', ':hover': '#000000' }
    },
    backgroundColor: {
      default: '#000000',
      '@media (hover: hover)': { default: '#000000', ':hover': '#000000' }
    },
    color: '#ffffff',
    boxShadow: 'none'
  },
  legacyIconSlot: {
    display: 'flex',
    width: 38,
    flexShrink: 0,
    justifyContent: 'center',
    marginRight: 16
  },
  legacyIconSelected: {
    filter: 'invert(1)'
  },
  legacyLabel: {
    fontFamily: 'SF Pro Text, Roboto, sans-serif',
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    letterSpacing: '-0.408px'
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
