import * as stylex from '@stylexjs/stylex'
import type { FormEvent } from 'react'
import type { CheckoutReview } from '@b2b-saas-starter/capabilities'
import { styles } from './booking-flow.styles.ts'

export function BookingCheckoutFlow({
  review,
  busy,
  invalid,
  onSubmit
}: {
  readonly review: CheckoutReview | null
  readonly busy: boolean
  readonly invalid: boolean
  readonly onSubmit: (details: {
    readonly name: string
    readonly email: string
    readonly phone: string | null
  }) => void
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
              {invalid ? (
                <div role="alert" {...stylex.props(styles.alert)}>
                  Check your name and email and try again.
                </div>
              ) : null}
              <div {...stylex.props(styles.fieldGrid)}>
                <Field label="Name" name="name" type="text" required />
                <Field label="Email" name="email" type="email" required />
                <Field label="Phone (optional)" name="phone" type="tel" />
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
            <Review review={review} />
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
}) {
  return (
    <label {...stylex.props(styles.label)}>
      <span {...stylex.props(styles.labelText)}>{props.label}</span>
      <input {...props} {...stylex.props(styles.input)} />
    </label>
  )
}

function Review({ review }: { readonly review: CheckoutReview }) {
  const currency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: review.quote.currency
  })
  const date = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(new Date(review.quote.startsAt))
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
      <button type="button" {...stylex.props(styles.primaryButton)}>
        Book
      </button>
      <p {...stylex.props(styles.privacy)}>
        By booking, you agree to the <a href="/terms">Terms of Service</a> and{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
    </section>
  )
}
