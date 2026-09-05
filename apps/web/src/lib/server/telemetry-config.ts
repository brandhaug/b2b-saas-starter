import { createServerFn } from '@tanstack/react-start'

/**
 * The public, non-secret subset of the observability provider env the
 * browser SDKs need, served through a **client-safe** server-fn module: the
 * client-safe half of the `telemetry-config.effects.ts` split (see
 * apps/web/AGENTS.md for the rule and `assert-client-boundary.mjs` for the
 * enforcement). Every field stays undefined when its variable is unset,
 * which keeps both vendors inactive on a provider-light deployment.
 */
export type ClientTelemetryConfig = {
  readonly sentryDsn: string | undefined
  readonly posthogKey: string | undefined
  readonly posthogHost: string | undefined
}

/** Hands the browser SDKs their config; identity-free, so no gate applies. */
export const clientTelemetryConfigServerFn = createServerFn({
  method: 'GET'
}).handler(async (): Promise<ClientTelemetryConfig> => {
  const { readClientTelemetryConfigHandler } =
    await import('./telemetry-config.effects')
  return readClientTelemetryConfigHandler()
})
