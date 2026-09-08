import {
  isSecurityNotificationKind,
  notificationKindDescription,
  notificationKindLabel
} from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import { type Locale } from '@b2b-saas-starter/i18n/locale'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import {
  NotificationPreferences,
  type NotificationPreference
} from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Effect } from 'effect'

import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import {
  type NotificationPreferenceRow,
  type NotificationPreferencesPayload,
  type SetNotificationPreferenceInput
} from './notification-preferences'

/**
 * The notification-preference effects and their server-only wiring, reached
 * only through dynamic `import()` inside the handlers of
 * `notification-preferences.ts` (see apps/web/AGENTS.md).
 * `notification-preferences.ts` holds the client-safe half and the reason
 * for the split.
 */

/**
 * One row of the `/account` preferences section: the resolved preference plus
 * the copy the page shows for it. Assembled here so the component renders
 * words and never imports the kind table.
 */
export function toPreferenceRow(
  preference: NotificationPreference,
  locale: Locale = 'en'
): NotificationPreferenceRow {
  return {
    ...preference,
    label: notificationKindLabel(preference.kind, locale),
    description: notificationKindDescription(preference.kind, locale),
    security: isSecurityNotificationKind(preference.kind)
  }
}

/**
 * The `/account` preferences segment, as an effect so the route's composed
 * loader (`account.effects.ts`) can run it beside its other identity-keyed
 * read.
 */
export function notificationPreferencesPayload(input: {
  readonly userId: string
  readonly locale?: Locale | undefined
}): Effect.Effect<
  NotificationPreferencesPayload,
  CapabilityUnavailable,
  NotificationPreferences
> {
  return Effect.map(
    Effect.flatMap(NotificationPreferences, (preferences) =>
      preferences.list(input.userId)
    ),
    (resolved) => ({
      preferences: resolved.map((preference) =>
        toPreferenceRow(preference, input.locale)
      )
    })
  )
}

/**
 * The `/account/notifications` loader segment: the signed-in user's full
 * preference matrix. The handler the server fn delegates to; the session
 * keys the read.
 */
export async function loadNotificationPreferencesHandler(): Promise<NotificationPreferencesPayload> {
  const session = await requireRequestSession()
  return runCapabilities(
    notificationPreferencesPayload({
      userId: session.user.id,
      locale: getLocale()
    })
  )
}

/**
 * Stores one choice for the signed-in user. The session gate is the whole
 * authorization: a preference is the user's own, keyed by their id, so no
 * workspace permission applies and no other user's row is reachable.
 */
export async function setNotificationPreferenceHandler(
  input: SetNotificationPreferenceInput
): Promise<NotificationPreferenceRow> {
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.gen(function* () {
      const preferences = yield* NotificationPreferences
      const set = yield* preferences.set({
        userId: session.user.id,
        kind: input.kind,
        channel: input.channel
      })
      return toPreferenceRow(set, getLocale())
    })
  )
}
