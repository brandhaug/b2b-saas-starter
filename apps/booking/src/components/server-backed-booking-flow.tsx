import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Schema } from 'effect'
import { useEffect, useMemo, useState } from 'react'
import {
  BookingAvailability as BookingAvailabilitySchema,
  CheckoutReview as CheckoutReviewSchema,
  BookingSchedulingRecovery as BookingSchedulingRecoverySchema,
  TimeSlotHold as TimeSlotHoldSchema,
  type BookingAvailability,
  type BookingSchedulingRecovery,
  type BookingJourney,
  type ProviderPreference,
  type ServiceSelection,
  type CheckoutReview,
  type CustomerDetails
} from '@b2b-saas-starter/capabilities'
import { BookingCheckoutFlow } from './booking-checkout-flow.tsx'
import { BookingSchedulingFlow } from './booking-scheduling-flow.tsx'
import { BookingSelectionFlow } from './booking-selection-flow.tsx'
import { styles } from './booking-flow.styles.ts'

export function ServerBackedBookingFlow({
  merchantSlug,
  sessionId
}: {
  readonly merchantSlug: string
  readonly sessionId: string
}) {
  const queryClient = useQueryClient()
  const [scheduling, setScheduling] = useState(false)
  const [slotLost, setSlotLost] = useState(false)
  const [holdExpired, setHoldExpired] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [review, setReview] = useState<CheckoutReview | null>(null)
  const [invalidDetails, setInvalidDetails] = useState(false)
  const [expiredSession, setExpiredSession] = useState(false)
  const base = `/${encodeURIComponent(merchantSlug)}/booking/session/${encodeURIComponent(sessionId)}`
  const queryKey = ['booking-selection', merchantSlug, sessionId] as const
  const journey = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`${base}/selection`, {
        credentials: 'same-origin'
      })
      if (!response.ok) throw new Error('selection unavailable')
      return (await response.json()) as BookingJourney
    }
  })
  const selectionMutation = useMutation({
    mutationFn: async (mutation: {
      readonly endpoint: 'provider' | 'services'
      readonly input: ProviderPreference | ServiceSelection
    }) => {
      const response = await fetch(`${base}/${mutation.endpoint}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mutation.input)
      })
      if (!response.ok) throw new Error('selection rejected')
      return (await response.json()) as BookingJourney
    },
    onSuccess: (value) => queryClient.setQueryData(queryKey, value)
  })
  const availabilityKey = useMemo(
    () => ['booking-availability', merchantSlug, sessionId] as const,
    [merchantSlug, sessionId]
  )
  const availability = useQuery({
    queryKey: availabilityKey,
    enabled: scheduling,
    queryFn: async () => {
      const response = await fetch(`${base}/availability`, {
        credentials: 'same-origin'
      })
      if (!response.ok) throw new Error('availability unavailable')
      return Schema.decodeUnknownSync(BookingAvailabilitySchema)(await response.json())
    }
  })
  const holdMutation = useMutation({
    mutationFn: async (startsAt: string) => {
      const response = await fetch(`${base}/hold`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startsAt })
      })
      if (response.status === 409) {
        const recovery: BookingSchedulingRecovery = Schema.decodeUnknownSync(
          BookingSchedulingRecoverySchema
        )(await response.json())
        if (recovery.kind === 'slot_lost') return null
      }
      if (!response.ok) throw new Error('hold unavailable')
      return Schema.decodeUnknownSync(TimeSlotHoldSchema)(await response.json())
    },
    onSuccess: (hold) => {
      if (!hold) {
        setHoldExpired(false)
        setSlotLost(true)
        void queryClient.invalidateQueries({ queryKey: availabilityKey })
        return
      }
      setHoldExpired(false)
      setSlotLost(false)
      queryClient.setQueryData<BookingAvailability>(availabilityKey, (current) =>
        current ? { ...current, hold } : current
      )
    }
  })
  const detailsMutation = useMutation({
    mutationFn: async (details: CustomerDetails) => {
      const response = await fetch(`${base}/customer-details`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(details)
      })
      if (response.status === 410) return { kind: 'session_expired' as const }
      if (response.status === 422) return { kind: 'invalid' as const }
      if (response.status === 409) return { kind: 'expired' as const }
      if (!response.ok) throw new Error('checkout unavailable')
      return {
        kind: 'review' as const,
        review: Schema.decodeUnknownSync(CheckoutReviewSchema)(await response.json())
      }
    },
    onSuccess: (result) => {
      if (result.kind === 'invalid') {
        setInvalidDetails(true)
        return
      }
      if (result.kind === 'session_expired') {
        setExpiredSession(true)
        return
      }
      if (result.kind === 'expired') {
        setCheckout(false)
        setHoldExpired(true)
        setReview(null)
        void queryClient.invalidateQueries({ queryKey: availabilityKey })
        return
      }
      setInvalidDetails(false)
      setReview(result.review)
    }
  })
  const confirmMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${base}/confirm`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
      if (response.status === 410) {
        setExpiredSession(true)
        return
      }
      if (!response.ok) throw new Error('confirmation unavailable')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: availabilityKey })
  })
  const heldUntil = availability.data?.hold?.expiresAt
  useEffect(() => {
    if (!heldUntil) return
    const expire = () => {
      setHoldExpired(true)
      setSlotLost(false)
      queryClient.setQueryData<BookingAvailability>(availabilityKey, (current) =>
        current ? { ...current, hold: null } : current
      )
      void queryClient.invalidateQueries({ queryKey: availabilityKey })
    }
    const remaining = Date.parse(heldUntil) - Date.now()
    if (remaining <= 0) {
      expire()
      return
    }
    const timer = window.setTimeout(expire, remaining)
    return () => window.clearTimeout(timer)
  }, [availabilityKey, heldUntil, queryClient])

  if (journey.isError || selectionMutation.isError)
    return (
      <Status
        title="Selection unavailable"
        copy="Your selection was not changed. Refresh to continue this Booking Session."
      />
    )
  if (!journey.data)
    return (
      <Status
        title="Preparing your booking"
        copy="Loading active services and professionals…"
      />
    )
  if (scheduling) {
    if (expiredSession) {
      return (
        <Status
          title="This Booking Session has expired"
          copy="Start again to choose a new appointment."
          href={`/${encodeURIComponent(merchantSlug)}/booking`}
          action="Start again"
        />
      )
    }
    if (checkout) {
      return (
        <BookingCheckoutFlow
          review={review}
          busy={detailsMutation.isPending || confirmMutation.isPending}
          invalid={invalidDetails}
          onSubmit={(details) => detailsMutation.mutate(details)}
          onBook={() => confirmMutation.mutate()}
        />
      )
    }
    if (availability.isError || holdMutation.isError)
      return (
        <Status
          title="Times unavailable"
          copy="Your service choices are still saved. Refresh to try again."
        />
      )
    if (!availability.data)
      return (
        <Status
          title="Finding available times"
          copy="Checking professional schedules and current holds…"
        />
      )
    return (
      <BookingSchedulingFlow
        availability={availability.data}
        busy={holdMutation.isPending}
        slotLost={slotLost}
        holdExpired={holdExpired}
        onSelect={(startsAt) => holdMutation.mutate(startsAt)}
        onCheckout={() => setCheckout(true)}
      />
    )
  }
  return (
    <BookingSelectionFlow
      journey={journey.data}
      busy={selectionMutation.isPending}
      onChooseProvider={(preference) =>
        selectionMutation.mutate({ endpoint: 'provider', input: preference })
      }
      onChooseServices={(selection) =>
        selectionMutation.mutate({ endpoint: 'services', input: selection })
      }
      onContinue={() => setScheduling(true)}
    />
  )
}

function Status({
  title,
  copy,
  href,
  action
}: {
  readonly title: string
  readonly copy: string
  readonly href?: string
  readonly action?: string
}) {
  return (
    <div {...stylex.props(styles.app)}>
      <div {...stylex.props(styles.widget)}>
        <main {...stylex.props(styles.main, styles.empty)}>
          <h1 {...stylex.props(styles.emptyTitle)}>{title}</h1>
          <p {...stylex.props(styles.emptyCopy)}>{copy}</p>
          {href && action ? <a href={href}>{action}</a> : null}
        </main>
      </div>
    </div>
  )
}
