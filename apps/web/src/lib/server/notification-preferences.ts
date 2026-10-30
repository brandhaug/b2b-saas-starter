import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/notification-preferences'
import { type NotificationPreference } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import {
  notificationChannels,
  notificationKinds,
  type NotificationKind as Kind
} from '@b2b-saas-starter/db/enums'
import { Schema } from 'effect'

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

export function isNotificationKind(value: string | undefined): value is Kind {
  return value !== undefined && notificationKinds.some((kind) => kind === value)
}

export const Api = HttpApi.make('web-notification-preferences').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadNotificationPreferencesServerFn',
      '/api/web/loadNotificationPreferencesServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.loadNotificationPreferencesServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'setNotificationPreferenceServerFn',
      '/api/web/setNotificationPreferenceServerFn',
      {
        payload: SetNotificationPreferenceInput,
        success: Responses.setNotificationPreferenceServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const setNotificationPreferenceServerFn = dataCall(
  browser,
  SetNotificationPreferenceInput,
  (client, payload) => client.calls.setNotificationPreferenceServerFn({ payload })
)
