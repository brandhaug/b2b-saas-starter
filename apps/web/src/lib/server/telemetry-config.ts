/** Public beacon configuration returned by the root loader. */
export type ClientTelemetryConfig = {
  readonly cloudflareWebAnalyticsToken: string | undefined
  readonly privacyController:
    | {
        readonly name: string
        readonly email: string
      }
    | undefined
}
