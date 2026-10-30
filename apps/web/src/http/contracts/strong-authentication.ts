import { Schema } from 'effect'

export const strongAuthenticationStatusServerFnResponse = Schema.Struct({
  qualified: Schema.Boolean,
  recent: Schema.Boolean,
  recovering: Schema.Boolean,
  hasFactors: Schema.Boolean,
  passwordVerified: Schema.Boolean
})
export const verifyCurrentPasswordServerFnResponse = Schema.Boolean
