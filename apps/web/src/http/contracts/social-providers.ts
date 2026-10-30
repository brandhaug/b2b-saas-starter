import { Schema } from 'effect'

export const getSocialProviderIdsResponse = Schema.Array(
  Schema.Union([Schema.Literal('github'), Schema.Literal('google')])
)
