import { Schema } from 'effect'
import {
  UpdateSsoConnectionSchema,
  OptionalSsoConnection,
  ResolveSsoRoutingSchema
} from './sso-records'

export const createSsoConnectionServerFnResponse = UpdateSsoConnectionSchema
export const updateSsoConnectionServerFnResponse = OptionalSsoConnection
export const removeSsoConnectionServerFnResponse = Schema.Boolean
export const testSsoConnectionServerFnResponse = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal('passed') }),
  Schema.Struct({
    outcome: Schema.Literal('failed'),
    code: Schema.String,
    message: Schema.String
  })
])
export const resolveSsoRoutingServerFnResponse = ResolveSsoRoutingSchema
