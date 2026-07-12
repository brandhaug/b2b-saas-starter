import * as stylex from '@stylexjs/stylex'
import {
  bookingRequestIsComplete,
  type BookingParty
} from '@b2b-saas-starter/capabilities/booking'
import { styles } from './booking-flow.styles.ts'

export type BookingPartyMessages = {
  readonly title: string
  readonly addGuest: string
  readonly removeGuest: string
  readonly moveEarlier: string
  readonly moveLater: string
  readonly guest: (position: number) => string
  readonly incomplete: string
  readonly complete: string
}

export function BookingPartyFlow({
  party,
  activeRequestId,
  busy,
  now,
  messages,
  onAdd,
  onRemove,
  onMove,
  onSwitch
}: {
  readonly party: BookingParty
  readonly activeRequestId: string
  readonly busy: boolean
  readonly now: string
  readonly messages: BookingPartyMessages
  readonly onAdd: () => void
  readonly onRemove: (requestId: string) => void
  readonly onMove: (requestId: string, direction: 'earlier' | 'later') => void
  readonly onSwitch: (requestId: string) => void
}) {
  const requests = [...party.requests].sort(
    (left, right) => left.position - right.position
  )
  return (
    <section
      aria-labelledby="booking-party-title"
      {...stylex.props(styles.checkoutSurface)}
    >
      <div {...stylex.props(styles.rowBetween)}>
        <h2 id="booking-party-title" {...stylex.props(styles.sectionTitle)}>
          {messages.title}
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={onAdd}
          {...stylex.props(styles.textButton)}
        >
          {messages.addGuest}
        </button>
      </div>
      <ol aria-live="polite" {...stylex.props(styles.gridTwo)}>
        {requests.map((request, index) => {
          const label = request.customerDetails?.name || messages.guest(index + 1)
          const isActive = request.id === activeRequestId
          return (
            <li key={request.id} {...stylex.props(styles.providerCard)}>
              <button
                type="button"
                aria-current={isActive ? 'step' : undefined}
                disabled={busy}
                onClick={() => onSwitch(request.id)}
                {...stylex.props(styles.textButton)}
              >
                {label}
              </button>
              <span {...stylex.props(styles.mutedSmall)}>
                {bookingRequestIsComplete(request, now)
                  ? messages.complete
                  : messages.incomplete}
              </span>
              <div {...stylex.props(styles.inlineActions)}>
                {requests.length > 1 ? (
                  <>
                    <button
                      type="button"
                      aria-label={`${messages.moveEarlier}: ${label}`}
                      disabled={busy || index === 0}
                      onClick={() => onMove(request.id, 'earlier')}
                      {...stylex.props(styles.textButton)}
                    >
                      {messages.moveEarlier}
                    </button>
                    <button
                      type="button"
                      aria-label={`${messages.moveLater}: ${label}`}
                      disabled={busy || index === requests.length - 1}
                      onClick={() => onMove(request.id, 'later')}
                      {...stylex.props(styles.textButton)}
                    >
                      {messages.moveLater}
                    </button>
                    <button
                      type="button"
                      aria-label={`${messages.removeGuest}: ${label}`}
                      disabled={busy || requests.length === 1}
                      onClick={() => onRemove(request.id)}
                      {...stylex.props(styles.textButton)}
                    >
                      {messages.removeGuest}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label={`${messages.removeGuest}: ${label}`}
                    disabled
                    {...stylex.props(styles.textButton)}
                  >
                    {messages.removeGuest}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
