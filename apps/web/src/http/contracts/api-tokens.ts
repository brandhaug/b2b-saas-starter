import { Schema } from 'effect'
import {
  LoadWorkspaceApiTokensSchema,
  CreateApiTokenSchema,
  ReplaceApiTokenSchema
} from './api-token-records'

export const loadWorkspaceApiTokensServerFnResponse = LoadWorkspaceApiTokensSchema
export const createApiTokenServerFnResponse = CreateApiTokenSchema
export const revokeApiTokenServerFnResponse = Schema.Boolean
export const replaceApiTokenServerFnResponse = ReplaceApiTokenSchema
