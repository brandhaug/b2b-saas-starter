import { type NotificationPreference } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import {
  notificationChannels,
  notificationKinds,
  type NotificationKind as Kind
} from '@b2b-saas-starter/db/enums'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The notification-preference server functions, in a **client-safe** module:
 * the client-safe half of the `notification-preferences.effects.ts` split
 * (see apps/web/AGENTS.md for the rule and `assert-client-boundary.mjs` for
 * the enforcement). Each input is written once, as its Effect Schema — the
 * validator is the single strict decode, and the derived type below types
 * both the client stub and the effects handler.
 */

/**
 * One row of the `/account` preferences section: the resolved preference plus
 * the copy the page shows for it. Assembled server-side (in the effects
 * file) so the component renders words and never imports the kind table.
 */
export type NotificationPreferenceRow = NotificationPreference & {
  readonly label: string
  readonly description: string
  readonly security: boolean
}

export type NotificationPreferencesPayload = {
  readonly preferences: ReadonlyArray<NotificationPreferenceRow>
}

// All input constraints live in the schema — no imperative re-validation.
const SetNotificationPreferenceInput = Schema.Struct({
  kind: Schema.Literals(notificationKinds),
  channel: Schema.Literals(notificationChannels)
})

export type SetNotificationPreferenceInput = typeof SetNotificationPreferenceInput.Type

/**
 * The `/account/notifications` loader segment: the signed-in user's full
 * preference matrix.
 */
export const loadNotificationPreferencesServerFn = createServerFn({
  method: 'GET'
}).handler(async (): Promise<NotificationPreferencesPayload> => {
  const { loadNotificationPreferencesHandler } =
    await import('./notification-preferences.effects')
  return loadNotificationPreferencesHandler()
})

/**
 * Stores one choice for the signed-in user. The session gate is the whole
 * authorization: a preference is the user's own, keyed by their id, so no
 * workspace permission applies and no other user's row is reachable.
 */
export const setNotificationPreferenceServerFn = createServerFn({
  method: 'POST'
})
  .validator(Schema.decodeUnknownSync(SetNotificationPreferenceInput))
  .handler(async ({ data }): Promise<NotificationPreferenceRow> => {
    const { setNotificationPreferenceHandler } =
      await import('./notification-preferences.effects')
    return setNotificationPreferenceHandler(data)
  })

/**
 * Whether a `?kind=` search value names a real kind. Reads the stored kind
 * tuple from `@b2b-saas-starter/db/enums` rather than the capability's kind
 * table: the table lives beside Effect schemas, and this probe runs in the
 * browser on the unsubscribe route.
 */
export function isNotificationKind(value: string | undefined): value is Kind {
  return value !== undefined && notificationKinds.some((kind) => kind === value)
}
