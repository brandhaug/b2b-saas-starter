import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall, readCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/admin'
import { DeliveryView } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-view'
import { type SystemRole } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type GlobalWebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { type WorkspaceSuspensionSummary } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { workspaceRoles } from '@/lib/permissions'
import { Schema } from 'effect'

export type SystemUser = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: SystemRole
  readonly banned: boolean
}

const SystemUserInput = Schema.Struct({ userId: Schema.NonEmptyString })

const ChangeWorkspaceRoleInput = Schema.Struct({
  userId: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString,
  role: Schema.Literals(workspaceRoles)
})

const FailedDeliveriesInput = Schema.Struct({
  cursor: Schema.optionalKey(Schema.String),
  view: Schema.optionalKey(Schema.fromJsonString(DeliveryView))
})

const ReplayFailedDeliveryInput = Schema.Struct({
  deliveryId: Schema.NonEmptyString
})

export type SystemUserInput = typeof SystemUserInput.Type
export type ChangeWorkspaceRoleInput = typeof ChangeWorkspaceRoleInput.Type
export type FailedDeliveriesInput = typeof FailedDeliveriesInput.Type
export type ReplayFailedDeliveryInput = typeof ReplayFailedDeliveryInput.Type

export type ReplayFailedDeliveryResult =
  | { readonly status: 'queued'; readonly deliveryId: string }
  | { readonly status: 'refused'; readonly reason: string }

export type FailedDeliveriesPayload = {
  readonly items: ReadonlyArray<GlobalWebhookDelivery>
  readonly nextCursor: string | null
}

export type AdminWorkspace = WorkspaceSuspensionSummary

const WorkspaceSuspensionInput = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  action: Schema.Literals(['suspend', 'unsuspend']),
  internalReason: Schema.NonEmptyString,
  customerExplanation: Schema.optionalKey(Schema.String)
})

export type WorkspaceSuspensionInput = typeof WorkspaceSuspensionInput.Type

export const Api = HttpApi.make('web-admin').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'listAdminWorkspacesServerFn',
      '/api/web/listAdminWorkspacesServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.listAdminWorkspacesServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'transitionAdminWorkspaceServerFn',
      '/api/web/transitionAdminWorkspaceServerFn',
      {
        payload: WorkspaceSuspensionInput,
        success: Responses.transitionAdminWorkspaceServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'listSystemUsersServerFn',
      '/api/web/listSystemUsersServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.listSystemUsersServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'loadAdminAuditEventsServerFn',
      '/api/web/loadAdminAuditEventsServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.loadAdminAuditEventsServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post('banSystemUserServerFn', '/api/web/banSystemUserServerFn', {
      payload: SystemUserInput,
      success: Responses.banSystemUserServerFnResponse,
      error: WebErrors
    }),
    HttpApiEndpoint.post(
      'unbanSystemUserServerFn',
      '/api/web/unbanSystemUserServerFn',
      {
        payload: SystemUserInput,
        success: Responses.unbanSystemUserServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'listUserWorkspacesServerFn',
      '/api/web/listUserWorkspacesServerFn',
      {
        payload: SystemUserInput,
        success: Responses.listUserWorkspacesServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'changeUserWorkspaceRoleServerFn',
      '/api/web/changeUserWorkspaceRoleServerFn',
      {
        payload: ChangeWorkspaceRoleInput,
        success: Responses.changeUserWorkspaceRoleServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'impersonateUserServerFn',
      '/api/web/impersonateUserServerFn',
      {
        payload: SystemUserInput,
        success: Responses.impersonateUserServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'stopImpersonatingServerFn',
      '/api/web/stopImpersonatingServerFn',
      {
        payload: Schema.Struct({}),
        success: Responses.stopImpersonatingServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'loadFailedDeliveriesServerFn',
      '/api/web/loadFailedDeliveriesServerFn',
      {
        payload: FailedDeliveriesInput,
        success: Responses.loadFailedDeliveriesServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'replayFailedDeliveryServerFn',
      '/api/web/replayFailedDeliveryServerFn',
      {
        payload: ReplayFailedDeliveryInput,
        success: Responses.replayFailedDeliveryServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const listAdminWorkspacesServerFn = readCall(browser, (client) =>
  client.calls.listAdminWorkspacesServerFn({ payload: {} })
)

export const transitionAdminWorkspaceServerFn = dataCall(
  browser,
  WorkspaceSuspensionInput,
  (client, payload) => client.calls.transitionAdminWorkspaceServerFn({ payload })
)

export const listSystemUsersServerFn = readCall(browser, (client) =>
  client.calls.listSystemUsersServerFn({ payload: {} })
)

export const loadAdminAuditEventsServerFn = readCall(browser, (client) =>
  client.calls.loadAdminAuditEventsServerFn({ payload: {} })
)

export const banSystemUserServerFn = dataCall(
  browser,
  SystemUserInput,
  (client, payload) => client.calls.banSystemUserServerFn({ payload })
)

export const unbanSystemUserServerFn = dataCall(
  browser,
  SystemUserInput,
  (client, payload) => client.calls.unbanSystemUserServerFn({ payload })
)

export const listUserWorkspacesServerFn = dataCall(
  browser,
  SystemUserInput,
  (client, payload) => client.calls.listUserWorkspacesServerFn({ payload })
)

export const changeUserWorkspaceRoleServerFn = dataCall(
  browser,
  ChangeWorkspaceRoleInput,
  (client, payload) => client.calls.changeUserWorkspaceRoleServerFn({ payload })
)

export const impersonateUserServerFn = dataCall(
  browser,
  SystemUserInput,
  (client, payload) => client.calls.impersonateUserServerFn({ payload })
)

export const stopImpersonatingServerFn = readCall(browser, (client) =>
  client.calls.stopImpersonatingServerFn({ payload: {} })
)

export const loadFailedDeliveriesServerFn = dataCall(
  browser,
  FailedDeliveriesInput,
  (client, payload) => client.calls.loadFailedDeliveriesServerFn({ payload })
)

export const replayFailedDeliveryServerFn = dataCall(
  browser,
  ReplayFailedDeliveryInput,
  (client, payload) => client.calls.replayFailedDeliveryServerFn({ payload })
)
