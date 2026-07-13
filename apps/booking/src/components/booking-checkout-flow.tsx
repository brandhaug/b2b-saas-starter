import * as stylex from '@stylexjs/stylex'
import { useMemo, useState, type FormEvent } from 'react'
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
import { BookingButton, BookingField } from '../presentation/booking-primitives.tsx'
import { BookingWidgetShell } from './booking-widget-shell.tsx'
import {
  BookingPremiumThemeBoundary,
  type BookingPremiumPalette
} from '../presentation/booking-premium-theme.tsx'

type CheckoutCopy = {
  readonly processing: string
  readonly title: string
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

export function BookingCheckoutFlow({
  review,
  preparation,
  busy,
  validationIssues,
  validationMessages,
  onSubmit,
  onFinalize,
  onEdit,
  payment,
  giftCard,
  copy = defaultCopy,
  premiumPalette = null
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
      readonly channel: 'email'
      readonly granted: boolean
    }[]
  }) => void
  readonly onEdit: (requestId: string) => void
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
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const value = (name: string) => {
      const entry = data.get(name)
      return typeof entry === 'string' ? entry : ''
    }
    const phone = value('phone').trim()
    onSubmit({
      name: value('name'),
      email: value('email'),
      phone: phone || null
    })
  }
  return (
    <BookingPremiumThemeBoundary palette={premiumPalette}>
      <BookingWidgetShell busy={busy} busyLabel={copy.processing}>
        <header {...stylex.props(styles.header)}>
          <h1 {...stylex.props(styles.title)}>{copy.title}</h1>
        </header>
        <main {...stylex.props(styles.main, styles.checkoutSurface)}>
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
      </BookingWidgetShell>
    </BookingPremiumThemeBoundary>
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
