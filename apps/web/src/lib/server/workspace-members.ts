import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/workspace-members'
import { type SeatUsage } from '@b2b-saas-starter/billing/plan-catalog'
import { type Member } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { type EmailDeliveryRow } from './email-delivery'
import { workspaceRoles, type WorkspaceViewer } from '@/lib/permissions'
import { Schema } from 'effect'

export type WorkspaceMembersPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly unreadCount: number
  readonly members: ReadonlyArray<Member>
  readonly invitations: ReadonlyArray<Invitation> | null
  readonly emailDeliveries: ReadonlyArray<EmailDeliveryRow> | null

  readonly seatUsage: SeatUsage
}

const LoadWorkspaceMembersInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const ChangeMemberRoleInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
  role: Schema.Literals(workspaceRoles)
})

const RemoveMemberInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  userId: Schema.NonEmptyString
})

const LeaveWorkspaceInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type LoadWorkspaceMembersInput = typeof LoadWorkspaceMembersInput.Type
export type ChangeMemberRoleInput = typeof ChangeMemberRoleInput.Type
export type RemoveMemberInput = typeof RemoveMemberInput.Type
export type LeaveWorkspaceInput = typeof LeaveWorkspaceInput.Type

export const Api = HttpApi.make('web-workspace-members').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadWorkspaceMembersServerFn',
      '/api/web/loadWorkspaceMembersServerFn',
      {
        payload: LoadWorkspaceMembersInput,
        success: Responses.loadWorkspaceMembersServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'changeMemberRoleServerFn',
      '/api/web/changeMemberRoleServerFn',
      {
        payload: ChangeMemberRoleInput,
        success: Responses.changeMemberRoleServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post('removeMemberServerFn', '/api/web/removeMemberServerFn', {
      payload: RemoveMemberInput,
      success: Responses.removeMemberServerFnResponse,
      error: WebErrors
    }),
    HttpApiEndpoint.post('leaveWorkspaceServerFn', '/api/web/leaveWorkspaceServerFn', {
      payload: LeaveWorkspaceInput,
      success: Responses.leaveWorkspaceServerFnResponse,
      error: WebErrors
    })
  )
)

const browser = makeBrowserClient(Api)

export const loadWorkspaceMembersServerFn = dataCall(
  browser,
  LoadWorkspaceMembersInput,
  (client, payload) => client.calls.loadWorkspaceMembersServerFn({ payload })
)

export const changeMemberRoleServerFn = dataCall(
  browser,
  ChangeMemberRoleInput,
  (client, payload) => client.calls.changeMemberRoleServerFn({ payload })
)

export const removeMemberServerFn = dataCall(
  browser,
  RemoveMemberInput,
  (client, payload) => client.calls.removeMemberServerFn({ payload })
)

export const leaveWorkspaceServerFn = dataCall(
  browser,
  LeaveWorkspaceInput,
  (client, payload) => client.calls.leaveWorkspaceServerFn({ payload })
)
