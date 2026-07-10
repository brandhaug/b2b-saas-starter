import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BookingJourney,
  ProviderPreference,
  ServiceSelection
} from '@b2b-saas-starter/capabilities'
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
