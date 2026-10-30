import { Schema } from 'effect'
import { ApiTokenRecords } from './dashboard-records'

export const ReplaceApiTokenSchema = Schema.Struct({
  previousTokenId: Schema.String,
  previousTokenExpiresAt: Schema.String,
  token: Schema.String,
  id: Schema.String,
  name: Schema.String,
  prefix: Schema.String,
  scopes: Schema.Array(
    Schema.Union([
      Schema.Literal('read'),
      Schema.Literal('admin'),
      Schema.Literal('write')
    ])
  ),
  lastUsedAt: Schema.Union([Schema.Null, Schema.String]),
  createdAt: Schema.String,
  expiresAt: Schema.Union([Schema.Null, Schema.String]),
  replacedByTokenId: Schema.Union([Schema.Null, Schema.String])
})

export const CreateApiTokenSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prefix: Schema.String,
  scopes: Schema.Array(
    Schema.Union([
      Schema.Literal('read'),
      Schema.Literal('admin'),
      Schema.Literal('write')
    ])
  ),
  lastUsedAt: Schema.Union([Schema.Null, Schema.String]),
  createdAt: Schema.String,
  expiresAt: Schema.Union([Schema.Null, Schema.String]),
  replacedByTokenId: Schema.Union([Schema.Null, Schema.String]),
  token: Schema.String
})

export const LoadWorkspaceApiTokensSchema = Schema.Struct({
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
  unreadCount: Schema.Number,
  tokens: ApiTokenRecords
})
