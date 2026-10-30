import { Schema } from 'effect'
import { OptionalApiTokens } from './dashboard-records'
import { OptionalSsoConnections } from './workspace-settings-records'

export const LoadWorkspaceDirectorySchema = Schema.Struct({
  workspace: Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    name: Schema.String,
    planId: Schema.String
  }),
  memberCount: Schema.Number,
  notificationCount: Schema.Number
})

export const WorkspaceDirectoryRecords = Schema.Array(LoadWorkspaceDirectorySchema)

export const LoadOAuthConsentSchema = Schema.Struct({
  client: Schema.Union([
    Schema.Null,
    Schema.Struct({
      clientId: Schema.String,
      name: Schema.Union([Schema.Null, Schema.String]),
      uri: Schema.Union([Schema.Null, Schema.String])
    })
  ]),
  workspaces: WorkspaceDirectoryRecords,
  oauthQuery: Schema.Union([Schema.Null, Schema.String])
})

export const LoadWorkspaceRecoverySchema = Schema.Struct({
  status: Schema.Union([Schema.Literal('active'), Schema.Literal('suspended')]),
  customerExplanation: Schema.Union([Schema.Null, Schema.String]),
  workspaceId: Schema.String,
  changedAt: Schema.Union([Schema.Null, Schema.String]),
  workspaceName: Schema.String,
  viewer: Schema.Struct({
    role: Schema.Union([
      Schema.Literal('owner'),
      Schema.Literal('admin'),
      Schema.Literal('member')
    ])
  }),
  canViewExplanation: Schema.Boolean,
  canManageBilling: Schema.Boolean,
  billingConfigured: Schema.Boolean,
  apiTokens: OptionalApiTokens,
  ssoConnections: OptionalSsoConnections
})

export const LoadWorkspaceSuspensionSchema = Schema.Struct({
  status: Schema.Union([Schema.Literal('active'), Schema.Literal('suspended')]),
  customerExplanation: Schema.Union([Schema.Null, Schema.String]),
  workspaceId: Schema.String,
  changedAt: Schema.Union([Schema.Null, Schema.String]),
  workspaceName: Schema.String,
  viewer: Schema.Struct({
    role: Schema.Union([
      Schema.Literal('owner'),
      Schema.Literal('admin'),
      Schema.Literal('member')
    ])
  }),
  strongAuthenticationRequired: Schema.Boolean
})
