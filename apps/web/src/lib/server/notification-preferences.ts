import { type NotificationPreference } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import {
  notificationKinds,
  type NotificationChannel,
  type NotificationKind as Kind
} from '@b2b-saas-starter/db/enums'
import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'

/**
 * The notification-preference server functions, in a **client-safe** module.
 *
 * This file is statically imported by the notifications route and the
 * preferences panel, and the route tree ships to the browser — so everything
 * at this module's top level rides on every page. That is why the capability
 * effects and their wiring (the preference service, the kind table's copy,
 * the Better Auth session gate) live in `notification-preferences.effects.ts`
 * and are reached only through dynamic `import()` inside each handler:
 * TanStack Start strips handler bodies from the client build, so the
 * capabilities graph never ships. The validators are stripped the same way
 * handler bodies are — `.validator()` runs on the server only — so the plain
 * shape checks below are the server's first decode, while the strict schemas
 * (the kind and channel literals) decode again in the effects file before
 * anything runs.
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

/** Input shape of `setNotificationPreferenceServerFn`, for its client stub. */
type SetNotificationPreferenceInput = {
  readonly kind: NotificationPreferenceRow['kind']
  readonly channel: NotificationChannel
}

/**
 * The server fn's validator, a plain shape check that runs on the server only
 * (TanStack strips `.validator()` from the client build): it is the server's
 * first decode, and the strict schema decodes again in
 * `notification-preferences.effects.ts`. This probe IS the I/O boundary, so
 * `unknown` in and `throw` out is the contract, the same exemption
 * `pickOptionalStrings` carries (lib/utils.ts).
 */
// oxlint-disable anti-slop/no-unknown-parameters, effect/noAs, typescript/no-unsafe-type-assertion
function decodeSetInput(input: unknown): SetNotificationPreferenceInput {
  const record = expectRecord(input, 'notification preference input')
  // SAFETY: the strict schema in `notification-preferences.effects.ts`
  // re-decodes kind and channel against the literal tuples before anything
  // runs; this check only establishes the wire shape for the client stub's
  // type.
  return {
    kind: expectString(
      record,
      'kind',
      'notification preference input'
    ) as SetNotificationPreferenceInput['kind'],
    channel: expectString(
      record,
      'channel',
      'notification preference input'
    ) as SetNotificationPreferenceInput['channel']
  }
}
// oxlint-enable anti-slop/no-unknown-parameters, effect/noAs, typescript/no-unsafe-type-assertion

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
  .validator(decodeSetInput)
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
