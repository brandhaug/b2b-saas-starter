import { Schema } from 'effect'
import { UpdateSsoConnectionSchema } from './sso-records'

export const RequestWorkspaceExportSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.Union([
    Schema.Literal('pending'),
    Schema.Literal('failed'),
    Schema.Literal('ready')
  ]),
  requestedAt: Schema.String,
  completedAt: Schema.Union([Schema.Null, Schema.String]),
  expiresAt: Schema.Union([Schema.Null, Schema.String]),
  sizeBytes: Schema.Union([Schema.Null, Schema.Number]),
  failureReason: Schema.Union([Schema.Null, Schema.String])
})

export const SsoConnectionsSchema = Schema.Array(UpdateSsoConnectionSchema)

export const OptionalSsoConnections = Schema.Union([Schema.Null, SsoConnectionsSchema])

export const WorkspaceExports = Schema.Array(RequestWorkspaceExportSchema)

export const WorkspaceExportSegment = Schema.Struct({
  availability: Schema.Union([
    Schema.Struct({ available: Schema.Literal(true) }),
    Schema.Struct({ available: Schema.Literal(false), reason: Schema.String })
  ]),
  exports: WorkspaceExports
})

export const OptionalWorkspaceExportSegment = Schema.Union([
  Schema.Null,
  WorkspaceExportSegment
])

export const LoadWorkspaceSettingsSchema = Schema.Struct({
  viewer: Schema.Union([
    Schema.Null,
    Schema.Struct({
      role: Schema.Union([
        Schema.Literal('owner'),
        Schema.Literal('admin'),
        Schema.Literal('member')
      ])
    })
  ]),
  workspaceName: Schema.String,
  unreadCount: Schema.Number,
  ssoConnections: OptionalSsoConnections,
  exports: OptionalWorkspaceExportSegment
})
