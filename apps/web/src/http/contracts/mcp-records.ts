import { Schema } from 'effect'

export const LoadMcpClientConnectionsSchema = Schema.Struct({
  id: Schema.String,
  scopes: Schema.Array(Schema.String),
  workspace: Schema.Union([
    Schema.Null,
    Schema.Struct({ id: Schema.String, slug: Schema.String, name: Schema.String })
  ]),
  client: Schema.Struct({
    clientId: Schema.String,
    name: Schema.Union([Schema.Null, Schema.String]),
    uri: Schema.Union([Schema.Null, Schema.String])
  }),
  grantedAt: Schema.String,
  resources: Schema.optionalKey(Schema.Array(Schema.String))
})

export const McpClientConnections = Schema.Array(LoadMcpClientConnectionsSchema)
