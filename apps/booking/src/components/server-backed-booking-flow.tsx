import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type {
  BookingAvailability,
  BookingJourney,
  ProviderPreference,
  ServiceSelection,
  TimeSlotHold
} from '@b2b-saas-starter/capabilities'
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
  const availabilityKey = ['booking-availability', merchantSlug, sessionId] as const
  const availability = useQuery({
    queryKey: availabilityKey,
    enabled: scheduling,
    queryFn: async () => {
      const response = await fetch(`${base}/availability`, {
        credentials: 'same-origin'
      })
      if (!response.ok) throw new Error('availability unavailable')
      return (await response.json()) as BookingAvailability
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
        const recovery = (await response.json()) as { readonly kind?: string }
        if (recovery.kind === 'slot_lost') return null
      }
      if (!response.ok) throw new Error('hold unavailable')
      return (await response.json()) as TimeSlotHold
    },
    onSuccess: (hold) => {
      if (!hold) {
        setSlotLost(true)
        void queryClient.invalidateQueries({ queryKey: availabilityKey })
        return
      }
      setSlotLost(false)
      queryClient.setQueryData<BookingAvailability>(availabilityKey, (current) =>
        current ? { ...current, hold } : current
      )
    }
  })

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
        onSelect={(startsAt) => holdMutation.mutate(startsAt)}
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

function Status({ title, copy }: { readonly title: string; readonly copy: string }) {
  return (
    <div {...stylex.props(styles.app)}>
      <div {...stylex.props(styles.widget)}>
        <main {...stylex.props(styles.main, styles.empty)}>
          <h1 {...stylex.props(styles.emptyTitle)}>{title}</h1>
          <p {...stylex.props(styles.emptyCopy)}>{copy}</p>
        </main>
      </div>
    </div>
  )
}
