import { Schema } from 'effect'

export const HealthResponse = Schema.Struct({ status: Schema.Literal('ok') })
