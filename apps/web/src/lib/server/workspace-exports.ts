import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/workspace-exports'
import {
  type WorkspaceExport,
  type WorkspaceExportAvailability
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { Schema } from 'effect'

export type WorkspaceExportsSegment = {
  readonly availability: WorkspaceExportAvailability
  readonly exports: ReadonlyArray<WorkspaceExport>
}

const RequestExportInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type RequestExportInput = typeof RequestExportInput.Type

const DownloadExportInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  exportId: Schema.NonEmptyString
})
export type DownloadExportInput = typeof DownloadExportInput.Type

export const Api = HttpApi.make('web-workspace-exports').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'requestWorkspaceExportServerFn',
      '/api/web/requestWorkspaceExportServerFn',
      {
        payload: RequestExportInput,
        success: Responses.requestWorkspaceExportServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'downloadWorkspaceExportServerFn',
      '/api/web/downloadWorkspaceExportServerFn',
      {
        payload: DownloadExportInput,
        success: Responses.downloadWorkspaceExportServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const requestWorkspaceExportServerFn = dataCall(
  browser,
  RequestExportInput,
  (client, payload) => client.calls.requestWorkspaceExportServerFn({ payload })
)

export const downloadWorkspaceExportServerFn = dataCall(
  browser,
  DownloadExportInput,
  (client, payload) => client.calls.downloadWorkspaceExportServerFn({ payload })
)
