import * as stylex from '@stylexjs/stylex'
import { useMemo, useState, type FormEvent } from 'react'
import type {
  CheckoutPreparation,
  CheckoutReview,
  CustomerDetailsIssue
} from '@b2b-saas-starter/capabilities/booking'
import { styles } from './booking-flow.styles.ts'

type CheckoutCopy = {
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
}
const defaultCopy: CheckoutCopy = {
  title: 'Confirm booking',
  guests: 'Guests',
  edit: 'Edit',
  emailOffers: (name) => `Email offers for ${name}`,
  operationalNotifications:
    'Operational booking notifications are sent regardless of marketing consent.',
  acceptPolicy: (version) => `Accept Checkout Policy version ${version}`,
  priceProposal: (version) => `Price proposal ${version}`,
  payInPerson: 'Pay In Person',
  book: 'Book',
  privacy: 'Customer Details are used for this booking.'
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
  copy = defaultCopy
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
      readonly personId: string
      readonly channel: 'email'
      readonly granted: boolean
      readonly policyVersion: string
    }[]
  }) => void
  readonly onEdit: (requestId: string) => void
  readonly copy?: CheckoutCopy
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
    <div {...stylex.props(styles.app)} aria-busy={busy}>
      <div {...stylex.props(styles.widget)}>
        <header {...stylex.props(styles.header)}>
          <h1 {...stylex.props(styles.title)}>{copy.title}</h1>
        </header>
        <main {...stylex.props(styles.main, styles.checkoutSurface)}>
          {!review ? (
            <form onSubmit={submit} noValidate>
              <div {...stylex.props(styles.fieldGrid)}>
                <Field
                  label="Name"
                  name="name"
                  type="text"
                  required
                  issues={validationIssues}
                  messages={validationMessages}
                />
                <Field
                  label="Email"
                  name="email"
                  type="email"
                  required
                  issues={validationIssues}
                  messages={validationMessages}
                />
                <Field
                  label="Phone (optional)"
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
                  Review booking
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
            />
          )}
        </main>
      </div>
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
  copy
}: {
  readonly review: CheckoutReview
  readonly preparation: CheckoutPreparation | null
  readonly busy: boolean
  readonly onFinalize: Parameters<typeof BookingCheckoutFlow>[0]['onFinalize']
  readonly onEdit: (requestId: string) => void
  readonly copy: CheckoutCopy
}) {
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [marketing, setMarketing] = useState<Record<string, boolean>>({})
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
        Total: {currency.format(review.quote.totalMinor / 100)} {review.quote.currency}
      </p>
      <p>{copy.payInPerson}</p>
      {preparation ? (
        <>
          <h2>{copy.guests}</h2>
          <ul>
            {preparation.party.requests.map((request) => (
              <li key={request.id}>
                <span>
                  {request.customerDetails?.name ?? `Guest ${request.position + 1}`}
                </span>{' '}
                <button type="button" onClick={() => onEdit(request.id)}>
                  {copy.edit}
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={marketing[request.id] ?? false}
                    onChange={(event) =>
                      setMarketing((current) => ({
                        ...current,
                        [request.id]: event.currentTarget.checked
                      }))
                    }
                  />
                  {copy.emailOffers(request.customerDetails?.name ?? 'this guest')}
                </label>
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
                  checked={policyAccepted || Boolean(preparation.policyAcceptance)}
                  disabled={Boolean(preparation.policyAcceptance)}
                  onChange={(event) => setPolicyAccepted(event.currentTarget.checked)}
                />
                {copy.acceptPolicy(preparation.policy.version)}
              </label>
            </section>
          ) : null}
          {preparation.quote ? (
            <section aria-label="Accepted price proposal">
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
          Boolean(
            preparation.policy && !preparation.policyAcceptance && !policyAccepted
          )
        }
        onClick={() =>
          preparation &&
          onFinalize({
            acceptQuote: !preparation.quote?.acceptedAt,
            acceptPolicy: Boolean(preparation.policy && !preparation.policyAcceptance),
            marketingConsents: preparation.party.requests.map((request) => ({
              personId: request.id,
              channel: 'email' as const,
              granted: marketing[request.id] ?? false,
              policyVersion: 'marketing:v1'
            }))
          })
        }
        {...stylex.props(styles.primaryButton)}
      >
        {copy.book}
      </button>
      <p {...stylex.props(styles.privacy)}>
        {copy.privacy} See the <a href="/privacy">Privacy Policy</a>.
      </p>
    </section>
  )
}
