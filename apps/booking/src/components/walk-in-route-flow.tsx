import { useEffect, useState, type FormEvent } from 'react'
import type { WalkInQueueEntry } from '@b2b-saas-starter/capabilities/walk-ins'
import type { BookingLocale } from '../localization/booking-localization.ts'
import {
  BookingStack,
  BookingSurface,
  BookingText,
  BookingViewport
} from '../presentation/booking-primitives.tsx'

export function WalkInRouteFlow({
  pathname,
  locale,
  acknowledgment
}: {
  pathname: string
  locale: BookingLocale
  acknowledgment: boolean
}) {
  const [queue, setQueue] = useState<readonly WalkInQueueEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    void fetch(pathname, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable')
        const value = await response.json()
        setQueue(
          acknowledgment ? [value as WalkInQueueEntry] : (value as WalkInQueueEntry[])
        )
      })
      .catch(() => setError('Walk-ins are unavailable right now.'))
  }, [acknowledgment, pathname])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const data = new FormData(event.currentTarget)
    const response = await fetch(pathname, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serviceId: data.get('serviceId'),
        providerPreference: { kind: 'any' },
        customerDetails: {
          name: data.get('name'),
          email: data.get('email'),
          phone: data.get('phone')
        },
        locale
      })
    })
    const result = (await response.json()) as { location?: string; error?: string }
    if (response.ok && result.location) window.location.assign(result.location)
    else {
      setError(
        result.error === 'walk_in_duplicate'
          ? 'You are already in this queue.'
          : result.error === 'walk_ins_closed'
            ? 'Walk-ins are closed right now.'
            : 'We could not add you to the queue.'
      )
      setSubmitting(false)
    }
  }
  const current = queue?.[0]
  return (
    <BookingViewport>
      <BookingStack>
        <BookingSurface>
          <BookingText variant="largeTitle">
            {acknowledgment ? 'Your walk-in status' : 'Walk in today'}
          </BookingText>
          {error ? <p role="alert">{error}</p> : null}
          {acknowledgment && current ? (
            <div aria-live="polite">
              <p>Status: {current.status}</p>
              <p>Position: {current.position}</p>
              <p>Estimated wait: {current.projectedWaitMinutes} minutes</p>
            </div>
          ) : acknowledgment ? (
            <p>Loading your private queue status…</p>
          ) : (
            <form onSubmit={submit}>
              <label>
                Service ID <input name="serviceId" required />
              </label>
              <label>
                Name <input name="name" autoComplete="name" required />
              </label>
              <label>
                Email <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>
                Phone <input name="phone" type="tel" autoComplete="tel" required />
              </label>
              <button disabled={submitting} type="submit">
                {submitting ? 'Joining…' : 'Join the queue'}
              </button>
            </form>
          )}
        </BookingSurface>
      </BookingStack>
    </BookingViewport>
  )
}
