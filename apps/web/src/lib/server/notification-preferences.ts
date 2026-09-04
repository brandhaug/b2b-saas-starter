import {
  NOTIFICATION_KIND_DESCRIPTIONS,
  NotificationChannel,
  NotificationKind,
  isSecurityNotificationKind,
  type NotificationKind as Kind
} from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import {
  NotificationPreferences,
  type NotificationPreference
} from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'

import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'

/**
 * One row of the `/account` preferences section: the resolved preference plus
 * the copy the page shows for it. Assembled here so the component renders
 * words and never imports the kind table.
 */
export type NotificationPreferenceRow = NotificationPreference & {
  readonly label: string
  readonly description: string
  readonly security: boolean
}

export type NotificationPreferencesPayload = {
  readonly preferences: ReadonlyArray<NotificationPreferenceRow>
}

export function toPreferenceRow(
  preference: NotificationPreference
): NotificationPreferenceRow {
  const copy = NOTIFICATION_KIND_DESCRIPTIONS[preference.kind]
  return {
    ...preference,
    label: copy.label,
    description: copy.description,
    security: isSecurityNotificationKind(preference.kind)
  }
}

/** The `/account` loader's segment: the signed-in user's full preference matrix. */
export function loadNotificationPreferences(input: {
  readonly userId: string
}): Promise<NotificationPreferencesPayload> {
  return runCapabilities(
    Effect.gen(function* () {
      const preferences = yield* NotificationPreferences
      const resolved = yield* preferences.list(input.userId)
      return { preferences: resolved.map(toPreferenceRow) }
    })
  )
}

// All input constraints live in the schema — no imperative re-validation.
const SetNotificationPreferenceInput = Schema.Struct({
  kind: NotificationKind,
  channel: NotificationChannel
})

const decodeSetInput = Schema.decodeUnknownSync(SetNotificationPreferenceInput)

/**
 * Stores one choice for the signed-in user. The session gate is the whole
 * authorization: a preference is the user's own, keyed by their id, so no
 * workspace permission applies and no other user's row is reachable.
 */
export const setNotificationPreferenceServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeSetInput(input))
  .handler(async ({ data }): Promise<NotificationPreferenceRow> => {
    const session = await requireRequestSession()
    return runCapabilities(
      Effect.gen(function* () {
        const preferences = yield* NotificationPreferences
        const set = yield* preferences.set({
          userId: session.user.id,
          kind: data.kind,
          channel: data.channel
        })
        return toPreferenceRow(set)
      })
    )
  })

/** Whether a `?kind=` search value names a real kind. */
export function isNotificationKind(value: string | undefined): value is Kind {
  return value !== undefined && Object.hasOwn(NOTIFICATION_KIND_DESCRIPTIONS, value)
}
