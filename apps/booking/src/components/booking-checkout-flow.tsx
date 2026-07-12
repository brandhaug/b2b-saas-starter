import * as stylex from '@stylexjs/stylex'
import { useMemo, type FormEvent } from 'react'
import type {
  CheckoutReview,
  CustomerDetailsIssue
} from '@b2b-saas-starter/capabilities/booking'
import { styles } from './booking-flow.styles.ts'

export function BookingCheckoutFlow({
  review,
  busy,
  validationIssues,
  validationMessages,
  onSubmit,
  onBook
}: {
  readonly review: CheckoutReview | null
  readonly busy: boolean
  readonly validationIssues: readonly CustomerDetailsIssue[]
  readonly validationMessages: Partial<Record<CustomerDetailsIssue['code'], string>>
  readonly onSubmit: (details: {
    readonly name: string
    readonly email: string
    readonly phone: string | null
  }) => void
  readonly onBook: () => void
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
          <h1 {...stylex.props(styles.title)}>Confirm booking</h1>
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
            <Review review={review} busy={busy} onBook={onBook} />
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
  busy,
  onBook
}: {
  readonly review: CheckoutReview
  readonly busy: boolean
  readonly onBook: () => void
}) {
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
      <p>Pay In Person</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => onBook()}
        {...stylex.props(styles.primaryButton)}
      >
        Book
      </button>
      <p {...stylex.props(styles.privacy)}>
        By booking, you agree to the <a href="/terms">Terms of Service</a> and{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
    </section>
  )
}
