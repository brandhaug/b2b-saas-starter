import { Schema } from 'effect'

export const TelemetrySchema = Schema.Struct({
  cloudflareWebAnalyticsToken: Schema.Union([Schema.Undefined, Schema.String]),
  privacyController: Schema.Union([
    Schema.Undefined,
    Schema.Struct({ name: Schema.String, email: Schema.String })
  ])
})

export const RootDataSchema = Schema.Struct({
  telemetry: TelemetrySchema,
  signedIn: Schema.Boolean
})
