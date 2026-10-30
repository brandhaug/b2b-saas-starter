import { Schema } from 'effect'

export const setLocalePreferencesServerFnResponse = Schema.Struct({
  locale: Schema.Union([Schema.Null, Schema.Literal('en'), Schema.Literal('nb')]),
  timeZone: Schema.Union([Schema.Null, Schema.String])
})
