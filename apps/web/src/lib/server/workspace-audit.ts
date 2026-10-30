import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/workspace-audit'
import {
  type AuditEvent,
  type AuditEventDetail
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { AuditView } from '@b2b-saas-starter/capabilities/governance/audit-event-view'
import { type WorkspaceViewer } from '@/lib/permissions'
import { Schema, type Types } from 'effect'

const WorkspaceAuditFilters = Schema.Struct({
  actorUserId: Schema.optionalKey(Schema.String),
  eventType: Schema.optionalKey(Schema.String),
  since: Schema.optionalKey(Schema.String),
  until: Schema.optionalKey(Schema.String)
})

export type WorkspaceAuditFilters = Types.Mutable<typeof WorkspaceAuditFilters.Type>

export type WorkspaceAuditPayload = {
  readonly selectedEvent: AuditEventDetail | null
  readonly viewer: WorkspaceViewer | null
  readonly events: ReadonlyArray<AuditEvent>

  readonly nextCursor: string | null

  readonly filters: WorkspaceAuditFilters
  readonly view?: AuditView
  readonly members: ReadonlyArray<{ readonly id: string; readonly name: string }>
}

const WorkspaceAuditInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  filters: WorkspaceAuditFilters,
  cursor: Schema.optionalKey(Schema.String),
  event: Schema.optionalKey(Schema.NonEmptyString),
  view: Schema.optionalKey(AuditView)
})

export type WorkspaceAuditInput = typeof WorkspaceAuditInput.Type

export const Api = HttpApi.make('web-workspace-audit').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'loadWorkspaceAuditEventsServerFn',
      '/api/web/loadWorkspaceAuditEventsServerFn',
      {
        payload: WorkspaceAuditInput,
        success: Responses.loadWorkspaceAuditEventsServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const loadWorkspaceAuditEventsServerFn = dataCall(
  browser,
  WorkspaceAuditInput,
  (client, payload) => client.calls.loadWorkspaceAuditEventsServerFn({ payload })
)
