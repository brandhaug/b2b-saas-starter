import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/workspace-lifecycle'
import { Schema } from 'effect'

// The slug rule is lowercase letters, digits, and inner hyphens; the plugin
// enforces uniqueness on top of it.
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

const CreateWorkspaceInput = Schema.Struct({
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  slug: Schema.NonEmptyString.check(Schema.isPattern(WORKSPACE_SLUG_PATTERN)).check(
    Schema.isMinLength(3)
  )
})

const RenameWorkspaceInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80))
})

const DeleteWorkspaceInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type CreateWorkspaceInput = typeof CreateWorkspaceInput.Type
export type RenameWorkspaceInput = typeof RenameWorkspaceInput.Type
export type DeleteWorkspaceInput = typeof DeleteWorkspaceInput.Type

// Rename and delete ARE workspace-scoped: the settings route resolves the
// workspace and the permission gates prove the actor may touch it.

export const Api = HttpApi.make('web-workspace-lifecycle').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'createWorkspaceServerFn',
      '/api/web/createWorkspaceServerFn',
      {
        payload: CreateWorkspaceInput,
        success: Responses.createWorkspaceServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'renameWorkspaceServerFn',
      '/api/web/renameWorkspaceServerFn',
      {
        payload: RenameWorkspaceInput,
        success: Responses.renameWorkspaceServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'deleteWorkspaceServerFn',
      '/api/web/deleteWorkspaceServerFn',
      {
        payload: DeleteWorkspaceInput,
        success: Responses.deleteWorkspaceServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const createWorkspaceServerFn = dataCall(
  browser,
  CreateWorkspaceInput,
  (client, payload) => client.calls.createWorkspaceServerFn({ payload })
)

export const renameWorkspaceServerFn = dataCall(
  browser,
  RenameWorkspaceInput,
  (client, payload) => client.calls.renameWorkspaceServerFn({ payload })
)

export const deleteWorkspaceServerFn = dataCall(
  browser,
  DeleteWorkspaceInput,
  (client, payload) => client.calls.deleteWorkspaceServerFn({ payload })
)
