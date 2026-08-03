import {
  CalendarDays,
  MapPin,
  Search,
  Scissors,
  Store,
  X,
  type LucideIcon,
  type LucideProps
} from 'lucide-react'
import type { ComponentType } from 'react'

export type BookingIconRole =
  | 'navigation-back'
  | 'navigation-menu'
  | 'language-selector'
  | 'location-nearby'
  | 'location-search'
  | 'booking-shop'
  | 'dismiss'
  | 'calendar-scheduling'
  | 'service-category'
  | 'sign-in-cta'
  | 'popup-close'
  | 'policy-cancellation'
  | 'policy-status-check'
  | 'identity-apple'
  | 'identity-google'

const iconByName: Readonly<Record<string, LucideIcon>> = {
  'calendar-days': CalendarDays,
  'map-pin': MapPin,
  search: Search,
  scissors: Scissors,
  store: Store,
  x: X
}

function LegacyBackChevron({
  size: _size,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...svgProps
}: LucideProps) {
  return (
    <svg
      width="9"
      height="16"
      viewBox="0 0 9 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...svgProps}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.07552 15.8411C8.54948 15.8411 8.91406 15.4766 8.91406 15.0026C8.91406 14.7747 8.8138 14.5651 8.66797 14.4102L2.04167 7.92057L8.66797 1.43099C8.8138 1.27604 8.91406 1.05729 8.91406 0.838542C8.91406 0.364583 8.54948 0 8.07552 0C7.84766 0 7.63802 0.0911458 7.48307 0.255208L0.264323 7.3099C0.0911465 7.46484 0 7.68359 0 7.92057C0 8.14844 0.0911465 8.35807 0.264323 8.53125L7.48307 15.5951C7.64714 15.75 7.84766 15.8411 8.07552 15.8411Z"
        fill="currentColor"
      />
    </svg>
  )
}

function LegacyWidgetMenu({
  size: _size,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...svgProps
}: LucideProps) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...svgProps}
    >
      <g stroke="currentColor" strokeWidth="1.5">
        <path d="M0 1h10" />
        <path d="M0 5h10" />
        <path d="M0 9h10" />
      </g>
    </svg>
  )
}

function LegacyLanguageGlobe(props: LucideProps) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" {...props}>
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M1 6h10M6 1c1.25 1.37 1.96 3.15 2 5-.04 1.85-.75 3.63-2 5-1.25-1.37-1.96-3.15-2-5 .04-1.85.75-3.63 2-5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LegacySignInCta(props: LucideProps) {
  return (
    <svg viewBox="0 0 73 72" fill="none" aria-hidden="true" {...props}>
      <rect
        x="1"
        y="0.5"
        width="71"
        height="71"
        rx="35.5"
        stroke="currentColor"
        opacity="0.3"
      />
      <path
        d="M35.6 25.7a10.3 10.3 0 1 1-8.6 15.9l-1.4.9A12 12 0 1 0 25.6 29.5l1.4.9a10.3 10.3 0 0 1 8.6-4.7Zm2 9.5H25.5v1.7h12.1L34.5 40l1.2 1.2 4.5-4.6a.85.85 0 0 0 0-1.2l-4.5-4.6-1.2 1.2 3.1 3.2Z"
        fill="currentColor"
      />
    </svg>
  )
}

function LegacyPopupClose(props: LucideProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="12" fill="#ebebeb" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.176 15.971a.6.6 0 1 0 .849.849L12 12.846l3.975 3.974a.6.6 0 0 0 .849-.849l-3.975-3.973 3.975-3.974a.6.6 0 1 0-.849-.848L12 11.149 8.025 7.176a.6.6 0 0 0-.849.848l3.975 3.974-3.975 3.973z"
      />
    </svg>
  )
}

function LegacyPolicyCancellation(props: LucideProps) {
  return (
    <svg viewBox="0 0 81 80" fill="none" aria-hidden="true" {...props}>
      <path
        fill="#000"
        fillRule="evenodd"
        clipRule="evenodd"
        d="m35.9733 28c.575 0 1.0411.4611 1.0411 1.0299v1.2089h6.9712v-1.2089c0-.5688.4661-1.0299 1.0411-1.0299.5751 0 1.0412.4611 1.0412 1.0299v1.2089h.7696c2.575 0 4.6625 2.0648 4.6625 4.6119v12.5373c0 2.5472-2.0875 4.612-4.6625 4.612h-12.6749c-2.5751 0-4.6626-2.0648-4.6626-4.612v-12.5373c0-2.5471 2.0875-4.6119 4.6626-4.6119h.7695v-1.2089c0-.5688.4661-1.0299 1.0412-1.0299zm8.0123 4.2985v1.209c0 .5687.4661 1.0298 1.0411 1.0298.5751 0 1.0412-.4611 1.0412-1.0298v-1.209h.7696c1.425 0 2.5802 1.1427 2.5802 2.5522v1.6568h-17.8354v-1.6568c0-1.4095 1.1552-2.5522 2.5803-2.5522h.7695v1.209c0 .5687.4661 1.0298 1.0412 1.0298.575 0 1.0411-.4611 1.0411-1.0298v-1.209zm-12.4033 6.2687v8.8208c0 1.4096 1.1552 2.5523 2.5803 2.5523h12.6749c1.425 0 2.5802-1.1427 2.5802-2.5523v-8.8208z"
      />
      <g stroke="#dadadc" strokeWidth="2">
        <path d="m13 12 55.5 55.5" />
        <rect width="78" height="78" x="1.5" y="1" rx="39" />
      </g>
    </svg>
  )
}

function LegacyPolicyStatusCheck(props: LucideProps) {
  return (
    <svg viewBox="0 0 11 8" fill="none" aria-hidden="true" {...props}>
      <path
        d="m1 4.693 2.333 2.215L9.366 1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const codeNativeIconByName: Readonly<Record<string, ComponentType<LucideProps>>> = {
  ...iconByName,
  'legacy-back-chevron': LegacyBackChevron,
  'legacy-widget-menu': LegacyWidgetMenu,
  'legacy-language-globe': LegacyLanguageGlobe,
  'legacy-sign-in-cta': LegacySignInCta,
  'legacy-popup-close': LegacyPopupClose,
  'legacy-policy-cancellation': LegacyPolicyCancellation,
  'legacy-policy-status-check': LegacyPolicyStatusCheck
}

const iconNameByRole: Readonly<
  Partial<Record<BookingIconRole, keyof typeof codeNativeIconByName>>
> = {
  'navigation-back': 'legacy-back-chevron',
  'navigation-menu': 'legacy-widget-menu',
  'language-selector': 'legacy-language-globe',
  'location-nearby': 'map-pin',
  'location-search': 'search',
  'booking-shop': 'store',
  dismiss: 'x',
  'calendar-scheduling': 'calendar-days',
  'service-category': 'scissors',
  'sign-in-cta': 'legacy-sign-in-cta',
  'popup-close': 'legacy-popup-close',
  'policy-cancellation': 'legacy-policy-cancellation',
  'policy-status-check': 'legacy-policy-status-check'
}

const textByRole: Readonly<Partial<Record<BookingIconRole, string>>> = {
  'identity-apple': 'Continue with Apple',
  'identity-google': 'Continue with Google'
}

export function BookingIcon({
  iconRole,
  label,
  ...iconProps
}: LucideProps & {
  readonly iconRole: BookingIconRole
  readonly label?: string
}) {
  const iconName = iconNameByRole[iconRole]
  if (!iconName) {
    const text = textByRole[iconRole]
    return text ? <span className={iconProps.className}>{label ?? text}</span> : null
  }

  const Icon = codeNativeIconByName[iconName]
  if (!Icon) return null
  return <Icon {...iconProps} />
}
