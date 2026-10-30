import { Schema } from 'effect'
import { LoadOAuthConsentSchema } from './directory-records'

export const loadOAuthConsentServerFnResponse = LoadOAuthConsentSchema
export const grantOAuthConsentServerFnResponse = Schema.Struct({ url: Schema.String })
export const denyOAuthConsentServerFnResponse = Schema.Struct({ url: Schema.String })
