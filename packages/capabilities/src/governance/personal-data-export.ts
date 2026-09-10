import { Context, type Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

export const PERSONAL_DATA_EXPORT_TTL_MS = 86_400_000

export const PersonalDataExportReceipt = Schema.Struct({
  id: Schema.String,
  expiresAt: Schema.String
})
export type PersonalDataExportReceipt = typeof PersonalDataExportReceipt.Type
export type PersonalDataExportDownload = {
  readonly fileName: string
  readonly json: string
}
export type PersonalDataExportInterface = {
  readonly request: (
    userId: string,
    sessionId: string
  ) => Effect.Effect<PersonalDataExportReceipt, CapabilityUnavailable>
  readonly download: (
    userId: string,
    sessionId: string,
    exportId: string
  ) => Effect.Effect<PersonalDataExportDownload, CapabilityUnavailable>
}
export class PersonalDataExports extends Context.Service<
  PersonalDataExports,
  PersonalDataExportInterface
>()('@b2b-saas-starter/capabilities/PersonalDataExports') {}
