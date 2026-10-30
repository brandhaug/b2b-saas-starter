import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/workspace-directory'
import { Schema } from 'effect'

export const Api = HttpApi.make('web-workspace-directory').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadWorkspaceDirectoryServerFn',
      '/api/web/loadWorkspaceDirectoryServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.loadWorkspaceDirectoryServerFnResponse,
        error: WebErrors
      }
    )
  )
)
