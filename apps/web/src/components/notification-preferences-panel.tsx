import { type NotificationChannel } from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import { useState } from 'react'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Badge } from '@/components/ui/badge'
import { FieldLabel } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { useServerAction } from '@/hooks/use-server-action'
import {
  setNotificationPreferenceServerFn,
  type NotificationPreferenceRow
} from '@/lib/server/notification-preferences'
import { cn } from '@/lib/utils'

const SAVE_FAILED = 'Could not save the preference'

/** The one server call this panel makes, as a port a test can replace. */
export type SetNotificationPreference = (input: {
  readonly data: {
    readonly kind: NotificationPreferenceRow['kind']
    readonly channel: NotificationChannel
  }
}) => Promise<NotificationPreferenceRow>

const CHANNELS: ReadonlyArray<{
  readonly value: NotificationChannel
  readonly label: string
}> = [
  { value: 'off', label: 'Off' },
  { value: 'instant', label: 'Instant' },
  { value: 'digest', label: 'Daily digest' }
]

/**
 * Per-kind email channel, one radio row per kind. The in-app feed is not
 * affected by any choice here; only email is. `highlightKind` is set when the
 * reader arrived from an email's unsubscribe link, so the row that email was
 * about is the first thing they see.
 */
export function NotificationPreferencesPanel({
  preferences,
  highlightKind,
  setPreference = setNotificationPreferenceServerFn
}: {
  readonly preferences: ReadonlyArray<NotificationPreferenceRow>
  readonly highlightKind?: NotificationPreferenceRow['kind'] | undefined
  readonly setPreference?: SetNotificationPreference
}) {
  // Optimistic view: the loader owns the truth after `router.invalidate()`,
  // this only keeps the clicked radio checked while the call is in flight —
  // and on a failed save the override is dropped so the row falls back to
  // loader truth instead of showing a channel the server refused.
  const [overrides, setOverrides] = useState<
    Readonly<Partial<Record<NotificationPreferenceRow['kind'], NotificationChannel>>>
  >({})
  const action = useServerAction(
    (input: {
      kind: NotificationPreferenceRow['kind']
      channel: NotificationChannel
    }) => setPreference({ data: input }),
    { failureMessage: SAVE_FAILED }
  )

  function select(row: NotificationPreferenceRow, channel: NotificationChannel) {
    setOverrides((current) => ({ ...current, [row.kind]: channel }))
    void (async () => {
      const outcome = await action.runAsync({ kind: row.kind, channel })
      if (!outcome.ok) {
        setOverrides(({ [row.kind]: _failed, ...fallback }) => fallback)
      }
    })()
  }

  return (
    <div className="grid gap-4">
      <ActionFeedback error={action.error} />
      <ul className="divide-y divide-border">
        {preferences.map((row) => {
          const value = overrides[row.kind] ?? row.channel
          const pending = action.pendingInput?.kind === row.kind
          const highlighted = row.kind === highlightKind
          return (
            <li
              key={row.kind}
              data-kind={row.kind}
              className={cn(
                'grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[1fr_auto] md:items-center',
                highlighted && '-mx-3 rounded-md bg-accent/40 px-3'
              )}
            >
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{row.label}</span>
                  {row.security ? <Badge variant="outline">Security</Badge> : null}
                  {row.isDefault ? (
                    <span className="text-xs text-muted-foreground">Default</span>
                  ) : null}
                  {pending ? <Spinner className="size-3" /> : null}
                </div>
                <p className="text-sm text-muted-foreground">{row.description}</p>
              </div>
              <RadioGroup<NotificationChannel>
                aria-label={`${row.label} email channel`}
                name={`channel-${row.kind}`}
                value={value}
                disabled={action.pending}
                onValueChange={(next) => select(row, next)}
                className="flex flex-wrap gap-3"
              >
                {CHANNELS.map((channel) => (
                  <FieldLabel key={channel.value} className="text-sm">
                    <RadioGroupItem value={channel.value} />
                    <span>{channel.label}</span>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Instant sends one email per notification as it happens. The daily digest arrives
        once a day at 08:00 UTC with everything unread from the last 24 hours. The
        in-app feed always shows every notification.
      </p>
    </div>
  )
}
