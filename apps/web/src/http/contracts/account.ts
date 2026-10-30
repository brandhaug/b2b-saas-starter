import { Schema } from 'effect'
import { LoadAccountPageSchema, DeleteAccountSchema } from './account-records'

export const loadAccountPageServerFnResponse = LoadAccountPageSchema
export const exportPersonalDataServerFnResponse = Schema.Struct({
  id: Schema.String,
  expiresAt: Schema.String
})
export const downloadPersonalDataServerFnResponse = Schema.Struct({
  fileName: Schema.String,
  json: Schema.String
})
export const deleteAccountServerFnResponse = DeleteAccountSchema
