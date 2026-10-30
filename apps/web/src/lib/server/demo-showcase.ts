import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/demo-showcase'
import { Schema } from 'effect'
import { type WorkspaceOverviewProjection } from '@b2b-saas-starter/capabilities/workspace-projections'

export type DemoShowcase = {
  readonly overview: WorkspaceOverviewProjection

  readonly memberCount: number
  readonly notificationCount: number

  readonly roleCount: number
  readonly auditEventTypeCount: number
}

export const Api = HttpApi.make('web-demo-showcase').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadDemoShowcaseServerFn',
      '/api/web/loadDemoShowcaseServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.loadDemoShowcaseServerFnResponse,
        error: WebErrors
      }
    )
  )
)
