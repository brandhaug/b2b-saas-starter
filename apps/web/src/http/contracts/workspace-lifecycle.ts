import { Schema } from 'effect'
import { HttpApiSchema } from 'effect/http-api'

export const createWorkspaceServerFnResponse = Schema.Struct({
  planId: Schema.String,
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String
})
export const renameWorkspaceServerFnResponse = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  planId: Schema.String
})
export const deleteWorkspaceServerFnResponse = HttpApiSchema.NoContent
