/**
 * The public, non-secret subset of the observability provider env the
 * browser SDKs need. The root route's `rootDataServerFn` (root-data.ts)
 * serves it alongside the session flag; this client-safe module holds only
 * the type, while `telemetry-config.effects.ts` reads the env (see
 * apps/web/AGENTS.md for the split and `assert-client-boundary.mjs` for the
 * enforcement). Every field stays undefined when its variable is unset,
 * which keeps both vendors inactive on a provider-light deployment.
 */
export type ClientTelemetryConfig = {
  readonly sentryDsn: string | undefined
  readonly posthogKey: string | undefined
  readonly posthogHost: string | undefined
}
