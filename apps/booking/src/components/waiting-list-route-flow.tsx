import { useEffect, useState, type FormEvent } from 'react'
import type { AvailabilityOffer } from '@b2b-saas-starter/capabilities/waiting-list'
import {
  BookingStack,
  BookingSurface,
  BookingText,
  BookingViewport
} from '../presentation/booking-primitives.tsx'

type State =
  | { kind: 'loading' }
  | { kind: 'offer'; offer: AvailabilityOffer }
  | { kind: 'accepted' }
  | { kind: 'applied'; applicationId: string }
  | { kind: 'declined' }
  | { kind: 'unavailable' }

export function WaitingListRouteFlow({
  pathname,
  application = false,
  applicationStatus = false
}: {
  pathname: string
  application?: boolean
  applicationStatus?: boolean
}) {
  const [state, setState] = useState<State>({
    kind: application ? 'unavailable' : 'loading'
  })
  useEffect(() => {
    if (application && !applicationStatus) return
    void fetch(pathname, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin'
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable')
        const result = (await response.json()) as {
          state: string
          offer?: AvailabilityOffer
        }
        if (applicationStatus)
          setState(
            result.state === 'active'
              ? { kind: 'applied', applicationId: pathname.split('/').at(-1)! }
              : result.state === 'withdrawn'
                ? { kind: 'declined' }
                : { kind: 'unavailable' }
          )
        else if (result.offer) setState({ kind: 'offer', offer: result.offer })
      })
      .catch(() => setState({ kind: 'unavailable' }))
  }, [application, applicationStatus, pathname])
  const apply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const field = (name: string) => {
      const value = data.get(name)
      return typeof value === 'string' ? value : ''
    }
    const until = new Date(field('until')).toISOString()
    const response = await fetch(pathname, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shopId: field('shopId'),
        request: {
          serviceIds: [field('serviceId')],
          providerPreference: { kind: 'any' },
          from: new Date(field('from')).toISOString(),
          until
        },
        customer: {
          name: field('name'),
          email: field('email'),
          phone: field('phone') || undefined
        },
        expiresAt: until
      })
    })
    if (!response.ok) return setState({ kind: 'unavailable' })
    const result = (await response.json()) as { id: string }
    setState({ kind: 'applied', applicationId: result.id })
  }
  const respond = async (method: 'POST' | 'DELETE') => {
    const response = await fetch(pathname, { method, credentials: 'same-origin' })
    if (!response.ok) return setState({ kind: 'unavailable' })
    const result = (await response.json()) as { sessionUrl?: string }
    if (method === 'POST' && result.sessionUrl)
      return window.location.assign(result.sessionUrl)
    setState({ kind: method === 'POST' ? 'accepted' : 'declined' })
  }
  return (
    <BookingViewport>
      <BookingStack>
        <BookingSurface>
          <BookingText variant="largeTitle">
            {application ? 'Join the waiting list' : 'Your availability offer'}
          </BookingText>
          {application &&
          !applicationStatus &&
          state.kind !== 'applied' &&
          state.kind !== 'declined' ? (
            <form onSubmit={apply}>
              <p>
                Tell us what works and we’ll contact you when a matching time opens.
              </p>
              <label>
                Shop ID <input name="shopId" required />
              </label>
              <label>
                Service ID <input name="serviceId" required />
              </label>
              <label>
                From <input name="from" type="datetime-local" required />
              </label>
              <label>
                Until <input name="until" type="datetime-local" required />
              </label>
              <label>
                Name <input name="name" autoComplete="name" required />
              </label>
              <label>
                Email <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>
                Phone <input name="phone" type="tel" autoComplete="tel" />
              </label>
              <button type="submit">Join the waiting list</button>
            </form>
          ) : null}
          {!application && state.kind === 'loading' ? (
            <p>Checking this private offer…</p>
          ) : null}
          {!application && state.kind === 'unavailable' ? (
            <p role="alert">This offer is unavailable or has expired.</p>
          ) : null}
          {state.kind === 'declined' ? (
            <p>
              {application
                ? 'Your application was withdrawn.'
                : 'You declined this offer. Your application remains active.'}
            </p>
          ) : null}
          {state.kind === 'applied' ? (
            <div>
              <p>
                Your application is active. We’ll send private offers one at a time.
              </p>
              <button
                type="button"
                onClick={() =>
                  void fetch(
                    applicationStatus ? pathname : `${pathname}/${state.applicationId}`,
                    {
                      method: 'DELETE',
                      credentials: 'same-origin'
                    }
                  ).then((response) =>
                    setState(
                      response.ok ? { kind: 'declined' } : { kind: 'unavailable' }
                    )
                  )
                }
              >
                Withdraw application
              </button>
            </div>
          ) : null}
          {state.kind === 'accepted' ? (
            <p>
              {application
                ? 'Your application is active. We’ll send private offers one at a time.'
                : 'Your time is being held while you finish booking.'}
            </p>
          ) : null}
          {!application && state.kind === 'offer' ? (
            <div>
              <p>{new Date(state.offer.slot.startsAt).toLocaleString()}</p>
              <button type="button" onClick={() => void respond('POST')}>
                Accept and continue
              </button>
              <button type="button" onClick={() => void respond('DELETE')}>
                Decline
              </button>
            </div>
          ) : null}
        </BookingSurface>
      </BookingStack>
    </BookingViewport>
  )
}
