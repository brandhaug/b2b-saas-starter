import { Schema } from 'effect'
import { RequestWorkspaceExportSchema } from './workspace-settings-records'

export const requestWorkspaceExportServerFnResponse = RequestWorkspaceExportSchema
export const downloadWorkspaceExportServerFnResponse = Schema.Union([
  Schema.Null,
  Schema.String
])
