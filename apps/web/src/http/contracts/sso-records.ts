import { Schema } from 'effect'

export const ResolveSsoRoutingSchema = Schema.Union([
  Schema.Null,
  Schema.Struct({
    providerId: Schema.String,
    protocol: Schema.Union([Schema.Literal('saml'), Schema.Literal('oidc')]),
    workspaceId: Schema.String,
    requireSso: Schema.Boolean
  })
])

export const UpdateSsoConnectionSchema = Schema.Struct({
  id: Schema.String,
  protocol: Schema.Union([Schema.Literal('saml'), Schema.Literal('oidc')]),
  domain: Schema.String,
  issuer: Schema.String,
  enabled: Schema.Boolean,
  requireSso: Schema.Boolean,
  defaultWorkspaceRole: Schema.Union([
    Schema.Literal('admin'),
    Schema.Literal('member')
  ]),
  clientIdLastFour: Schema.Union([Schema.Null, Schema.String]),
  createdAt: Schema.String
})

export const OptionalSsoConnection = Schema.Union([
  Schema.Null,
  UpdateSsoConnectionSchema
])
