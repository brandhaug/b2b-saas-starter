import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  type CountryCode
} from 'libphonenumber-js'
import { validateCustomerDetailsField } from '@b2b-saas-starter/capabilities/booking'
import type {
  CheckoutPreparation,
  CheckoutReview,
  CustomerDetailsIssue
} from '@b2b-saas-starter/capabilities/booking'
import type {
  PaymentMethod,
  PaymentMethodEligibility
} from '@b2b-saas-starter/capabilities/payments'
import { styles } from './booking-flow.styles.ts'
import {
  PaymentMethodSelector,
  type PaymentPresentationStatus
} from './payment-method-selector.tsx'
import {
  BookingButton,
  BookingField,
  BookingPopupSheet
} from '../presentation/booking-primitives.tsx'
import { BookingWidgetShell } from './booking-widget-shell.tsx'
import {
  BookingPremiumThemeBoundary,
  type BookingPremiumPalette
} from '../presentation/booking-premium-theme.tsx'
import '../styles/legacy-phone-flags.css'

type CheckoutCopy = {
  readonly processing: string
  readonly title: string
  readonly haveAccount: string
  readonly signIn: string
  readonly close: string
  readonly guests: string
  readonly edit: string
  readonly emailOffers: (name: string) => string
  readonly operationalNotifications: string
  readonly acceptPolicy: (version: number) => string
  readonly priceProposal: (version: number) => string
  readonly payInPerson: string
  readonly book: string
  readonly privacy: string
  readonly privacyLink: string
  readonly name: string
  readonly yourInformation: string
  readonly firstName: string
  readonly lastName: string
  readonly phoneNumber: string
  readonly chooseCountry: string
  readonly searchCountry: string
  readonly clearSearch: string
  readonly yourRegion: string
  readonly countryRegion: string
  readonly firstNameRequired: string
  readonly lastNameRequired: string
  readonly emailInvalid: string
  readonly phoneInvalid: string
  readonly email: string
  readonly phoneOptional: string
  readonly reviewBooking: string
  readonly total: string
  readonly giftCard: string
  readonly giftCardCode: string
  readonly giftCardAmount: string
  readonly applyGiftCard: string
  readonly removeGiftCard: string
  readonly giftCardApplied: string
  readonly giftCardUnavailable: string
}
const defaultCopy: CheckoutCopy = {
  processing: 'Processing…',
  title: 'Confirm booking',
  haveAccount: 'Have an account?',
  signIn: 'Sign in',
  close: 'Close',
  guests: 'Guests',
  edit: 'Edit',
  emailOffers: (name) => `Email offers for ${name}`,
  operationalNotifications:
    'Operational booking notifications are sent regardless of marketing consent.',
  acceptPolicy: (version) => `Accept Checkout Policy version ${version}`,
  priceProposal: (version) => `Price proposal ${version}`,
  payInPerson: 'Pay in person',
  book: 'Book',
  privacy: 'Customer Details are used for this booking.',
  privacyLink: 'See the Privacy Policy',
  name: 'Name',
  yourInformation: 'Your information',
  firstName: 'First name',
  lastName: 'Last name',
  phoneNumber: 'Phone number',
  chooseCountry: 'Choose country',
  searchCountry: 'Search country or region',
  clearSearch: 'Clear search',
  yourRegion: 'Your region',
  countryRegion: 'Country or region',
  firstNameRequired: 'First name is required',
  lastNameRequired: 'Last name is required',
  emailInvalid: 'Enter a valid email address',
  phoneInvalid: 'Enter a valid phone number',
  email: 'Email',
  phoneOptional: 'Phone (optional)',
  reviewBooking: 'Review booking',
  total: 'Total',
  giftCard: 'Gift card',
  giftCardCode: 'Gift card code',
  giftCardAmount: 'Amount to apply',
  applyGiftCard: 'Apply gift card',
  removeGiftCard: 'Remove gift card',
  giftCardApplied: 'Gift card applied',
  giftCardUnavailable: 'Gift card unavailable'
}

const currencyFormatters = new Map<string, Intl.NumberFormat>()
const formatCurrency = (currency: string, amountMinor: number) => {
  let formatter = currencyFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency })
    currencyFormatters.set(currency, formatter)
  }
  return formatter.format(amountMinor / 100)
}

export function BookingCheckoutFlow({
  review,
  preparation,
  busy,
  validationIssues,
  validationMessages,
  onSubmit,
  onFinalize,
  onEdit,
  onClose,
  onSignIn,
  payment,
  giftCard,
  copy = defaultCopy,
  premiumPalette = null,
  presentation = 'standalone',
  shopName,
  shopAddressLines,
  countryCode = 'US',
  locale = 'en',
  popupTarget = null,
  draftSummary
}: {
  readonly review: CheckoutReview | null
  readonly preparation: CheckoutPreparation | null
  readonly busy: boolean
  readonly validationIssues: readonly CustomerDetailsIssue[]
  readonly validationMessages: Partial<Record<CustomerDetailsIssue['code'], string>>
  readonly onSubmit: (details: {
    readonly name: string
    readonly email: string
    readonly phone: string | null
  }) => void
  readonly onFinalize: (input: {
    readonly acceptQuote: boolean
    readonly acceptPolicy: boolean
    readonly marketingConsents: readonly {
      readonly bookingRequestId: string
      readonly channel: 'email' | 'sms'
      readonly granted: boolean
    }[]
  }) => void
  readonly onEdit: (requestId: string) => void
  readonly onClose?: () => void
  readonly onSignIn?: () => void
  readonly payment?:
    | {
        readonly eligibility: PaymentMethodEligibility
        readonly selected: PaymentMethod
        readonly status: PaymentPresentationStatus
        readonly allowPayInPerson?: boolean
        readonly onSelect: (method: PaymentMethod) => void
        readonly legend: string
        readonly labels: Record<PaymentMethod, string>
        readonly messages: {
          readonly disabled: string
          readonly needs_configuration: string
          readonly processing: string
          readonly failed: string
          readonly succeeded: string
        }
      }
    | undefined
  readonly giftCard?: {
    readonly appliedMinor: number
    readonly status: 'idle' | 'applying' | 'applied' | 'failed'
    readonly onApply: (giftCardCode: string, amountMinor: number) => void
    readonly onRemove: () => void
  }
  readonly copy?: CheckoutCopy
  readonly premiumPalette?: BookingPremiumPalette | null
  readonly presentation?: 'standalone' | 'withinBookingShell'
  readonly shopName?: string
  readonly shopAddressLines?: readonly string[]
  readonly countryCode?: CountryCode
  readonly locale?: string
  readonly popupTarget?: HTMLElement | null
  readonly draftSummary?: {
    readonly services: readonly { readonly id: string; readonly name: string }[]
    readonly totalMinor: number
    readonly currency: string
  }
}) {
  const [legacyFirstName, setLegacyFirstName] = useState('')
  const [legacyLastName, setLegacyLastName] = useState('')
  const [legacyEmail, setLegacyEmail] = useState('')
  const [legacySubmitAttempted, setLegacySubmitAttempted] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const value = (name: string) => {
      const entry = data.get(name)
      return typeof entry === 'string' ? entry : ''
    }
    const phone = value('phone').trim()
    const phoneCountryCode = value('phoneCountryCode')
    const legacyName = [value('firstName'), value('lastName')]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ')
    if (withinBookingShell) {
      setLegacySubmitAttempted(true)
      const invalid = [
        validateCustomerDetailsField({
          field: 'name',
          value: value('firstName'),
          required: true
        }),
        validateCustomerDetailsField({
          field: 'name',
          value: value('lastName'),
          required: true
        }),
        validateCustomerDetailsField({
          field: 'phone',
          value: phone ? `${phoneCountryCode}${phone}` : '',
          required: true
        }),
        validateCustomerDetailsField({
          field: 'email',
          value: value('email'),
          required: true
        })
      ].some(Boolean)
      if (invalid) return
    }
    onSubmit({
      name: value('name') || legacyName,
      email: value('email'),
      phone: phone
        ? `${phoneCountryCode}${phone}`.replace(/(?!^)\+/g, '').replace(/[^+\d]/g, '')
        : null
    })
  }
  const withinBookingShell = presentation === 'withinBookingShell'
  if (withinBookingShell) {
    const summary = review
      ? {
          services: review.quote.services,
          totalMinor: review.quote.totalMinor,
          currency: review.quote.currency
        }
      : draftSummary
    const formattedTotal = summary
      ? formatCurrency(summary.currency, summary.totalMinor)
      : null
    return (
      <form
        data-testid="checkout-form"
        onSubmit={submit}
        noValidate
        {...stylex.props(styles.legacyCheckoutForm)}
      >
        <div {...stylex.props(styles.legacyCheckoutTop)}>
          <div
            data-testid="container:checkout-title"
            {...stylex.props(styles.checkoutPopupHeader)}
          >
            <p {...stylex.props(styles.checkoutPopupTitle)}>{copy.title}</p>
            {onSignIn ? (
              <div {...stylex.props(styles.checkoutSignInRow)}>
                <p {...stylex.props(styles.checkoutSignInLabel)}>{copy.haveAccount}</p>
                <button
                  type="button"
                  onClick={onSignIn}
                  {...stylex.props(styles.checkoutSignInButton)}
                >
                  {copy.signIn}
                </button>
              </div>
            ) : null}
            {onClose ? (
              <button
                type="button"
                aria-label={copy.close}
                data-testid="btn:closeCheckout"
                onClick={onClose}
                {...stylex.props(styles.checkoutPopupClose)}
              >
                <svg
                  aria-hidden="true"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  {...stylex.props(styles.checkoutPopupCloseIcon)}
                >
                  <circle cx="12" cy="12" r="12" fill="#ebebeb" />
                  <path
                    fill="currentColor"
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M7.176 15.971a.6.6 0 1 0 .849.849L12 12.846l3.975 3.974a.6.6 0 0 0 .849-.849l-3.975-3.973 3.975-3.974a.6.6 0 1 0-.849-.848L12 11.149 8.025 7.176a.6.6 0 0 0-.849.848l3.975 3.974-3.975 3.973z"
                  />
                </svg>
              </button>
            ) : null}
          </div>
          <div
            data-checkout-section="shop"
            {...stylex.props(styles.legacyCheckoutShop)}
          >
            <span
              aria-hidden="true"
              {...stylex.props(styles.legacyCheckoutShopImage)}
            />
            <div {...stylex.props(styles.legacyCheckoutShopDetails)}>
              <p {...stylex.props(styles.checkoutShopName)}>{shopName}</p>
              {shopAddressLines?.length ? (
                <p {...stylex.props(styles.legacyCheckoutShopAddress)}>
                  {shopAddressLines.join(' ')}
                </p>
              ) : null}
            </div>
          </div>
          <div
            data-checkout-section="payment"
            {...stylex.props(styles.legacyCheckoutPayment)}
          >
            {payment ? (
              <PaymentMethodSelector {...payment} presentation="legacyCheckout" />
            ) : (
              <p {...stylex.props(styles.legacyCheckoutSectionTitle)}>
                {copy.payInPerson}
              </p>
            )}
          </div>
          <div
            data-checkout-section="customer"
            {...stylex.props(styles.legacyCheckoutCustomer)}
          >
            <p {...stylex.props(styles.legacyCheckoutP1Bold)}>{copy.yourInformation}</p>
            <div {...stylex.props(styles.legacyCheckoutCustomerFields)}>
              <div {...stylex.props(styles.legacyCheckoutCustomerForm)}>
                <div {...stylex.props(styles.legacyCheckoutNameRow)}>
                  <LegacyField
                    testId="input:firstName"
                    label={copy.firstName}
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    issueField="name"
                    validationField="name"
                    required
                    value={legacyFirstName}
                    forceValidation={legacySubmitAttempted}
                    localErrorMessage={copy.firstNameRequired}
                    issues={validationIssues}
                    messages={validationMessages}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      if (!value.includes(' ')) {
                        setLegacyFirstName(value)
                        return
                      }
                      const [firstName, lastName] = value.split(' ')
                      setLegacyFirstName(firstName ?? '')
                      setLegacyLastName(lastName ?? '')
                    }}
                  />
                  <LegacyField
                    testId="input:lastName"
                    label={copy.lastName}
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    validationField="name"
                    required
                    value={legacyLastName}
                    forceValidation={legacySubmitAttempted}
                    localErrorMessage={copy.lastNameRequired}
                    onChange={(event) => setLegacyLastName(event.currentTarget.value)}
                    issues={validationIssues}
                    messages={validationMessages}
                  />
                </div>
                <LegacyPhoneField
                  key={countryCode}
                  label={copy.phoneNumber}
                  countryCode={countryCode}
                  locale={locale}
                  popupTarget={popupTarget}
                  copy={copy}
                  forceValidation={legacySubmitAttempted}
                  issues={validationIssues}
                  messages={validationMessages}
                />
                <LegacyField
                  testId="input:email"
                  label={copy.email}
                  name="email"
                  type="email"
                  autoComplete="email"
                  issueField="email"
                  validationField="email"
                  required
                  value={legacyEmail}
                  forceValidation={legacySubmitAttempted}
                  localErrorMessage={copy.emailInvalid}
                  onChange={(event) => setLegacyEmail(event.currentTarget.value)}
                  issues={validationIssues}
                  messages={validationMessages}
                />
              </div>
            </div>
          </div>
        </div>
        <div {...stylex.props(styles.legacyCheckoutBottom)}>
          <div
            data-checkout-section="summary"
            {...stylex.props(styles.legacyCheckoutSummary)}
          >
            <h2 {...stylex.props(styles.legacyCheckoutSectionTitle)}>Summary</h2>
            {summary ? (
              <div {...stylex.props(styles.legacyCheckoutSummaryLines)}>
                {summary.services.map((service) => (
                  <div
                    key={service.id}
                    {...stylex.props(styles.legacyCheckoutSummaryLine)}
                  >
                    <span>{service.name}</span>
                  </div>
                ))}
                <div {...stylex.props(styles.legacyCheckoutTotal)}>
                  <strong>{copy.total}</strong>
                  <strong>{formattedTotal}</strong>
                </div>
              </div>
            ) : null}
            {preparation?.policy ? (
              <p {...stylex.props(styles.legacyCheckoutDisclosure)}>
                {preparation.policy.disclosure}
              </p>
            ) : null}
          </div>
          <div
            data-checkout-section="action"
            {...stylex.props(styles.legacyCheckoutAction)}
          >
            <button
              type="submit"
              disabled={busy}
              data-testid="btn:book"
              {...stylex.props(styles.primaryButton, styles.legacyCheckoutBook)}
            >
              {copy.book}
            </button>
            <p {...stylex.props(styles.legacyCheckoutDisclaimer)}>
              By booking, you agree to the shop's policies.{' '}
              <a href="/privacy">{copy.privacyLink}</a>.
            </p>
          </div>
        </div>
      </form>
    )
  }
  const content = (
    <>
      <header
        {...stylex.props(
          withinBookingShell ? styles.checkoutPopupHeader : styles.header
        )}
      >
        <h1 {...stylex.props(styles.title)}>{copy.title}</h1>
      </header>
      <main
        {...stylex.props(
          withinBookingShell && styles.checkoutPopupSurface,
          !withinBookingShell && styles.main,
          !withinBookingShell && styles.checkoutSurface
        )}
      >
        {withinBookingShell && shopName ? (
          <p {...stylex.props(styles.checkoutShopName)}>{shopName}</p>
        ) : null}
        {!review ? (
          <form onSubmit={submit} noValidate>
            <div {...stylex.props(styles.fieldGrid)}>
              <Field
                label={copy.name}
                name="name"
                type="text"
                required
                issues={validationIssues}
                messages={validationMessages}
              />
              <Field
                label={copy.email}
                name="email"
                type="email"
                required
                issues={validationIssues}
                messages={validationMessages}
              />
              <Field
                label={copy.phoneOptional}
                name="phone"
                type="tel"
                issues={validationIssues}
                messages={validationMessages}
              />
            </div>
            <div {...stylex.props(styles.inlineActions)}>
              <span />
              <button
                type="submit"
                disabled={busy}
                {...stylex.props(styles.primaryButton)}
              >
                {copy.reviewBooking}
              </button>
            </div>
          </form>
        ) : (
          <Review
            review={review}
            preparation={preparation}
            busy={busy}
            onFinalize={onFinalize}
            onEdit={onEdit}
            copy={copy}
            payment={payment}
            giftCard={giftCard}
          />
        )}
      </main>
    </>
  )
  return (
    <BookingPremiumThemeBoundary palette={premiumPalette}>
      <BookingWidgetShell busy={busy} busyLabel={copy.processing}>
        {content}
      </BookingWidgetShell>
    </BookingPremiumThemeBoundary>
  )
}

function LegacyField(props: {
  readonly testId: string
  readonly label: string
  readonly name: string
  readonly type: string
  readonly autoComplete: string
  readonly issueField?: string
  readonly validationField: CustomerDetailsIssue['field']
  readonly required?: boolean
  readonly value?: string
  readonly forceValidation?: boolean
  readonly localErrorMessage: string
  readonly issues: readonly CustomerDetailsIssue[]
  readonly messages: Partial<Record<CustomerDetailsIssue['code'], string>>
  readonly onChange?: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  const [localIssue, setLocalIssue] = useState<CustomerDetailsIssue['code'] | null>(
    null
  )
  const validate = (value: string) =>
    validateCustomerDetailsField({
      field: props.validationField,
      value,
      required: props.required ?? false
    })
  const externalIssue = props.issues.find(
    (candidate) => candidate.field === (props.issueField ?? props.name)
  )
  const issueCode =
    externalIssue?.code ??
    (props.forceValidation && props.value !== undefined
      ? validate(props.value)
      : localIssue && props.value !== undefined
        ? validate(props.value)
        : localIssue)
  const errorId = issueCode ? `${props.name}-error` : undefined
  return (
    <div {...stylex.props(styles.legacyCheckoutField)}>
      <input
        data-testid={props.testId}
        name={props.name}
        type={props.type}
        autoComplete={props.autoComplete}
        aria-label={props.label}
        aria-invalid={Boolean(issueCode)}
        aria-describedby={errorId}
        placeholder={props.label}
        value={props.value}
        onChange={(event) => {
          if (localIssue) setLocalIssue(validate(event.currentTarget.value))
          props.onChange?.(event)
        }}
        onBlur={(event) => {
          setLocalIssue(validate(event.currentTarget.value))
        }}
        {...stylex.props(
          styles.legacyCheckoutInput,
          issueCode && styles.legacyCheckoutInputError
        )}
      />
      {issueCode ? (
        <span
          id={errorId}
          role="alert"
          {...stylex.props(styles.legacyCheckoutFieldError)}
        >
          {issueCode === 'name_required'
            ? props.localErrorMessage
            : (props.messages[issueCode] ?? props.localErrorMessage)}
        </span>
      ) : null}
    </div>
  )
}

type LegacyPhoneCountry = {
  readonly iso2: CountryCode
  readonly dialCode: string
}

const legacyPhoneCountries: readonly LegacyPhoneCountry[] = getCountries().map(
  (iso2) => ({ iso2, dialCode: getCountryCallingCode(iso2) })
)

function LegacyPhoneField(props: {
  readonly label: string
  readonly countryCode: CountryCode
  readonly locale: string
  readonly popupTarget: HTMLElement | null
  readonly forceValidation?: boolean
  readonly copy: Pick<
    CheckoutCopy,
    | 'chooseCountry'
    | 'searchCountry'
    | 'clearSearch'
    | 'yourRegion'
    | 'countryRegion'
    | 'close'
    | 'phoneInvalid'
  >
  readonly issues: readonly CustomerDetailsIssue[]
  readonly messages: Partial<Record<CustomerDetailsIssue['code'], string>>
}) {
  const [country, setCountry] = useState<LegacyPhoneCountry>(
    () =>
      legacyPhoneCountries.find((candidate) => candidate.iso2 === props.countryCode) ??
      legacyPhoneCountries[0] ?? { iso2: 'US', dialCode: '1' }
  )
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [phone, setPhone] = useState('')
  const [touched, setTouched] = useState(false)
  const regionNames = useMemo(
    () => new Intl.DisplayNames([props.locale], { type: 'region' }),
    [props.locale]
  )
  const countryName = (candidate: LegacyPhoneCountry) =>
    regionNames.of(candidate.iso2) ?? candidate.iso2
  const countriesForList = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(props.locale).replace('+', '')
    return legacyPhoneCountries.filter((candidate) => {
      if (!query) return candidate.iso2 !== country.iso2
      const name = regionNames.of(candidate.iso2) ?? candidate.iso2
      return (
        candidate.iso2.toLocaleLowerCase().includes(query) ||
        candidate.dialCode.includes(query) ||
        name.toLocaleLowerCase(props.locale).includes(query)
      )
    })
  }, [country.iso2, props.locale, regionNames, search])
  const closeCountryPopup = () => {
    setSearch('')
    setOpen(false)
  }
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSearch('')
        setOpen(false)
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])
  const externalIssue = props.issues.find((candidate) => candidate.field === 'phone')
  const localPhone = `${country.dialCode}${phone.replace(/\D/g, '')}`
  const issueCode =
    externalIssue?.code ??
    (touched || props.forceValidation
      ? validateCustomerDetailsField({
          field: 'phone',
          value: `+${localPhone}`,
          required: true
        })
      : undefined)
  const errorId = issueCode ? 'phone-error' : undefined
  return (
    <div {...stylex.props(styles.legacyCheckoutField)}>
      <div {...stylex.props(styles.legacyPhoneInput)}>
        <button
          type="button"
          aria-label={`${props.copy.chooseCountry}, ${countryName(country)} +${country.dialCode}`}
          aria-expanded={open}
          data-testid="btn:phoneCountry"
          onClick={() => {
            if (open) setSearch('')
            setOpen((current) => !current)
          }}
          {...stylex.props(styles.legacyPhoneCountry)}
          className={`${stylex.props(styles.legacyPhoneCountry).className} react-tel-input`}
        >
          <span aria-hidden="true" className={`flag ${country.iso2.toLowerCase()}`} />
          <span aria-hidden="true">+{country.dialCode}</span>
          <svg aria-hidden="true" width="10" height="6" viewBox="0 0 10 6">
            <path
              d="M0 .796C0 .358.344 0 .77 0c.212 0 .411.091.567.25l3.66 3.868L8.663.25A.79.79 0 0 1 9.23 0c.427 0 .771.358.771.796a.78.78 0 0 1-.222.552L5.618 5.71c-.183.199-.382.29-.62.29-.24 0-.433-.097-.622-.29L.222 1.348A.76.76 0 0 1 0 .796Z"
              fill="rgb(135, 135, 139)"
            />
          </svg>
        </button>
        <input
          data-testid="input:phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          aria-label={props.label}
          aria-invalid={Boolean(issueCode)}
          aria-describedby={errorId}
          placeholder={props.label}
          value={phone}
          onChange={(event) => {
            const digits = event.currentTarget.value.replace(/\D/g, '')
            setPhone(new AsYouType(country.iso2).input(digits))
          }}
          onBlur={() => setTouched(true)}
          {...stylex.props(
            styles.legacyCheckoutInput,
            styles.legacyPhoneNumber,
            issueCode && styles.legacyCheckoutInputError
          )}
        />
      </div>
      <BookingPopupSheet
        target={props.popupTarget}
        open={open}
        label={props.copy.chooseCountry}
        onClose={closeCountryPopup}
        testId="popup:phoneCountry"
        presenceKey="phoneCode"
        legacyGeometry
      >
        <div {...stylex.props(styles.legacyPhoneCountries)}>
          <button
            type="button"
            aria-label={props.copy.close}
            data-testid="btn:close"
            onClick={closeCountryPopup}
            {...stylex.props(styles.legacyPhonePopupClose)}
          >
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="12" fill="var(--bg, #EBEBEB)" />
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M7.176 15.971a.6.6 0 1 0 .849.849L12 12.846l3.975 3.974a.6.6 0 0 0 .849-.849l-3.975-3.973 3.975-3.974a.6.6 0 1 0-.849-.848L12 11.149 8.025 7.176a.6.6 0 0 0-.849.848l3.975 3.974-3.975 3.973z"
                fill="var(--content, currentColor)"
              />
            </svg>
          </button>
          <h2 {...stylex.props(styles.legacyPhonePopupTitle)}>
            {props.copy.chooseCountry}
          </h2>
          <div {...stylex.props(styles.legacyPhoneSearchWrap)}>
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              {...stylex.props(styles.legacyPhoneSearchIcon)}
            >
              <path
                d="M6.048 11.378c1.046 0 2.03-.3 2.864-.82l2.816 2.816c.226.226.534.335.848.335.663 0 1.162-.513 1.162-1.176 0-.3-.102-.601-.335-.827L10.614 8.91c.574-.868.903-1.9.903-3.008 0-3.007-2.461-5.475-5.47-5.475C3.04.427.573 2.887.573 5.902c0 3.008 2.468 5.476 5.476 5.476Zm0-1.668a3.823 3.823 0 0 1-3.815-3.808 3.823 3.823 0 0 1 3.815-3.807 3.822 3.822 0 0 1 3.807 3.807A3.822 3.822 0 0 1 6.048 9.71Z"
                fill="currentColor"
              />
            </svg>
            <input
              autoFocus
              type="search"
              autoComplete="off"
              value={search}
              aria-label={props.copy.searchCountry}
              placeholder={props.copy.searchCountry}
              onChange={(event) => setSearch(event.currentTarget.value)}
              {...stylex.props(styles.legacyPhoneSearch)}
            />
            {search ? (
              <button
                type="button"
                aria-label={props.copy.clearSearch}
                onClick={() => setSearch('')}
                {...stylex.props(styles.legacyPhoneSearchReset)}
              >
                <svg aria-hidden="true" width="8" height="8" viewBox="0 0 12 11">
                  <path
                    d="M.892 9.003c-.356.362-.375 1.029.012 1.41.388.387 1.048.374 1.41.012l3.58-3.58 3.573 3.574c.375.38 1.022.374 1.403-.013.387-.38.387-1.028.013-1.403L7.309 5.43l3.574-3.58c.374-.375.374-1.022-.013-1.403-.38-.387-1.028-.387-1.403-.013L5.894 4.008 2.313.428C1.952.072 1.285.053.904.44.523.828.536 1.488.892 1.85l3.58 3.58-3.58 3.574Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            ) : null}
          </div>
          {!search ? (
            <>
              <p {...stylex.props(styles.legacyPhonePopupLabel)}>
                {props.copy.yourRegion}
              </p>
              <LegacyPhoneCountryRow
                country={country}
                name={countryName(country)}
                selected
                onSelect={closeCountryPopup}
              />
            </>
          ) : null}
          <p {...stylex.props(styles.legacyPhonePopupLabel)}>
            {props.copy.countryRegion}
          </p>
          <div {...stylex.props(styles.legacyPhoneCountryScroll)}>
            {countriesForList.map((option) => (
              <LegacyPhoneCountryRow
                key={option.iso2}
                country={option}
                name={countryName(option)}
                onSelect={() => {
                  setCountry(option)
                  setPhone((current) =>
                    new AsYouType(option.iso2).input(current.replace(/\D/g, ''))
                  )
                  setSearch('')
                  setOpen(false)
                }}
              />
            ))}
          </div>
        </div>
      </BookingPopupSheet>
      <input type="hidden" name="phoneCountryCode" value={`+${country.dialCode}`} />
      {issueCode ? (
        <span
          id={errorId}
          role="alert"
          {...stylex.props(styles.legacyCheckoutFieldError)}
        >
          {externalIssue
            ? (props.messages[issueCode] ?? props.copy.phoneInvalid)
            : props.copy.phoneInvalid}
        </span>
      ) : null}
    </div>
  )
}

function LegacyPhoneCountryRow({
  country,
  name,
  selected = false,
  onSelect
}: {
  readonly country: LegacyPhoneCountry
  readonly name: string
  readonly selected?: boolean
  readonly onSelect: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${name} (+${country.dialCode})`}
      aria-pressed={selected}
      onClick={onSelect}
      {...stylex.props(styles.legacyPhoneCountryOption)}
      className={`${stylex.props(styles.legacyPhoneCountryOption).className} react-tel-input`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <div
        aria-hidden="true"
        className={`flag ${country.iso2.toLowerCase()} ${stylex.props(styles.legacyPhonePopupFlag).className}`}
      />
      <span {...stylex.props(styles.legacyPhoneCountryName)}>{name}</span>
      <span {...stylex.props(styles.legacyPhoneDialCode)}>(+{country.dialCode})</span>
      {selected ? (
        <span aria-hidden="true" {...stylex.props(styles.legacyPhoneCheckmark)}>
          <svg width="7" height="5" viewBox="0 0 11 8" fill="none">
            <path
              d="m1 4.693 2.333 2.215L9.366 1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}
    </div>
  )
}

function Field(props: {
  readonly label: string
  readonly name: string
  readonly type: string
  readonly required?: boolean
  readonly issues: readonly CustomerDetailsIssue[]
  readonly messages: Partial<Record<CustomerDetailsIssue['code'], string>>
}) {
  const issue = props.issues.find((candidate) => candidate.field === props.name)
  const errorId = issue ? `${props.name}-error` : undefined
  const { issues: _, messages: __, ...input } = props
  return (
    <div {...stylex.props(styles.label)}>
      <label htmlFor={props.name} {...stylex.props(styles.labelText)}>
        {props.label}
      </label>
      <input
        {...input}
        id={props.name}
        aria-invalid={Boolean(issue)}
        aria-describedby={errorId}
        {...stylex.props(styles.input)}
      />
      {issue ? (
        <span id={errorId} role="alert" {...stylex.props(styles.alert)}>
          {props.messages[issue.code] ?? issue.code}
        </span>
      ) : null}
    </div>
  )
}

function Review({
  review,
  preparation,
  busy,
  onFinalize,
  onEdit,
  copy,
  payment,
  giftCard
}: {
  readonly review: CheckoutReview
  readonly preparation: CheckoutPreparation | null
  readonly busy: boolean
  readonly onFinalize: Parameters<typeof BookingCheckoutFlow>[0]['onFinalize']
  readonly onEdit: (requestId: string) => void
  readonly copy: CheckoutCopy
  readonly payment: Parameters<typeof BookingCheckoutFlow>[0]['payment']
  readonly giftCard: Parameters<typeof BookingCheckoutFlow>[0]['giftCard']
}) {
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [marketing, setMarketing] = useState<Record<string, boolean>>({})
  const policyAlreadyAccepted = Boolean(
    preparation?.policy &&
    preparation.policyAcceptance?.policyId === preparation.policy.id &&
    preparation.policyAcceptance.version === preparation.policy.version &&
    preparation.policyAcceptance.disclosure === preparation.policy.disclosure
  )
  const currency = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: review.quote.currency
      }),
    [review.quote.currency]
  )
  const date = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'UTC'
      }).format(new Date(review.quote.startsAt)),
    [review.quote.startsAt]
  )
  return (
    <section>
      <p>{date}</p>
      <p>{review.quote.assignedProvider.displayName}</p>
      <ul>
        {review.quote.services.map((service) => (
          <li key={service.id}>
            {service.name} — {currency.format(service.priceMinor / 100)}
          </li>
        ))}
      </ul>
      <p>
        {copy.total}: {currency.format(review.quote.totalMinor / 100)}{' '}
        {review.quote.currency}
      </p>
      {giftCard ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const giftCardEntry = data.get('gift-card-code')
            const giftCardCode =
              typeof giftCardEntry === 'string' ? giftCardEntry.trim() : ''
            const amount = Number(data.get('gift-card-amount'))
            if (giftCardCode && Number.isFinite(amount) && amount > 0)
              giftCard.onApply(giftCardCode, Math.round(amount * 100))
          }}
        >
          <fieldset disabled={busy || giftCard.status === 'applying'}>
            <legend>{copy.giftCard}</legend>
            <BookingField label={copy.giftCardCode} name="gift-card-code" required />
            <BookingField
              label={copy.giftCardAmount}
              name="gift-card-amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
            <BookingButton type="submit" tone="primary">
              {copy.applyGiftCard}
            </BookingButton>
            {giftCard.appliedMinor > 0 ? (
              <BookingButton type="button" onClick={giftCard.onRemove}>
                {copy.removeGiftCard}
              </BookingButton>
            ) : null}
            <output>
              {giftCard.status === 'applied'
                ? `${copy.giftCardApplied}: ${currency.format(giftCard.appliedMinor / 100)}`
                : giftCard.status === 'failed'
                  ? copy.giftCardUnavailable
                  : null}
            </output>
          </fieldset>
        </form>
      ) : null}
      {payment ? (
        <PaymentMethodSelector {...payment} />
      ) : giftCard?.appliedMinor ? null : (
        <p>{copy.payInPerson}</p>
      )}
      {preparation ? (
        <>
          <h2>{copy.guests}</h2>
          <ul>
            {preparation.party.requests.map((request) => (
              <li key={request.id}>
                {(() => {
                  const requestReview = preparation.requestReviews.find(
                    (candidate) => candidate.requestId === request.id
                  )
                  if (!requestReview) return null
                  return (
                    <div>
                      <span>{requestReview.quote.assignedProvider.displayName}</span>
                      <ul>
                        {requestReview.quote.services.map((service) => (
                          <li key={service.id}>{service.name}</li>
                        ))}
                      </ul>
                    </div>
                  )
                })()}
                <span>
                  {request.customerDetails?.name ?? `Guest ${request.position + 1}`}
                </span>{' '}
                <span>
                  {request.startsAt
                    ? new Intl.DateTimeFormat(preparation.party.locale, {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      }).format(new Date(request.startsAt))
                    : null}
                </span>{' '}
                <button type="button" onClick={() => onEdit(request.id)}>
                  {copy.edit}
                </button>
                {preparation.marketingPolicy ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        marketing[request.id] ??
                        preparation.marketingConsents.find(
                          (consent) =>
                            consent.bookingRequestId === request.id &&
                            consent.channel === 'email'
                        )?.granted ??
                        false
                      }
                      onChange={(event) =>
                        setMarketing((current) => ({
                          ...current,
                          [request.id]: event.currentTarget.checked
                        }))
                      }
                    />
                    {copy.emailOffers(request.customerDetails?.name ?? 'this guest')}
                    <span>{preparation.marketingPolicy.disclosure}</span>
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
          <p>{copy.operationalNotifications}</p>
          {preparation.policy ? (
            <section aria-label="Checkout policy">
              <p>{preparation.policy.disclosure}</p>
              <label>
                <input
                  type="checkbox"
                  checked={policyAccepted || policyAlreadyAccepted}
                  disabled={policyAlreadyAccepted}
                  onChange={(event) => setPolicyAccepted(event.currentTarget.checked)}
                />
                {copy.acceptPolicy(preparation.policy.version)}
              </label>
            </section>
          ) : null}
          {preparation.quote ? (
            <section aria-label="Price proposal">
              <p>
                {copy.priceProposal(preparation.quote.version)}:{' '}
                {currency.format(preparation.quote.totalMinor / 100)}
              </p>
              {preparation.quote.adjustments.map((adjustment) => (
                <p key={adjustment.id}>
                  {adjustment.label}: {currency.format(adjustment.amountMinor / 100)}
                </p>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
      <button
        type="button"
        disabled={
          busy ||
          !preparation?.quote ||
          Boolean(preparation.policy && !policyAlreadyAccepted && !policyAccepted)
        }
        onClick={() =>
          preparation &&
          onFinalize({
            acceptQuote: !preparation.quote?.acceptedAt,
            acceptPolicy: Boolean(preparation.policy && !policyAlreadyAccepted),
            marketingConsents: preparation.marketingPolicy
              ? preparation.party.requests.map((request) => ({
                  bookingRequestId: request.id,
                  channel: 'email' as const,
                  granted:
                    marketing[request.id] ??
                    preparation.marketingConsents.find(
                      (consent) =>
                        consent.bookingRequestId === request.id &&
                        consent.channel === 'email'
                    )?.granted ??
                    false
                }))
              : []
          })
        }
        {...stylex.props(styles.primaryButton)}
      >
        {copy.book}
      </button>
      <p {...stylex.props(styles.privacy)}>
        {copy.privacy} <a href="/privacy">{copy.privacyLink}</a>.
      </p>
    </section>
  )
}
