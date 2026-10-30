import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/workspace-onboarding'
import { Schema } from 'effect'

const DismissInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type DismissInput = typeof DismissInput.Type

export const Api = HttpApi.make('web-workspace-onboarding').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'dismissOnboardingChecklistServerFn',
      '/api/web/dismissOnboardingChecklistServerFn',
      {
        payload: DismissInput,
        success: Responses.dismissOnboardingChecklistServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const dismissOnboardingChecklistServerFn = dataCall(
  browser,
  DismissInput,
  (client, payload) => client.calls.dismissOnboardingChecklistServerFn({ payload })
)
