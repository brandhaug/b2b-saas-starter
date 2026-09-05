import { createServerFn } from '@tanstack/react-start'

/**
 * The public, non-secret subset of the observability provider env the browser
 * SDKs need, served through a **client-safe** server-fn module. The env-bag
 * read lives in `telemetry-config.effects.ts`, reached only through dynamic
 * `import()` inside the handler: TanStack Start strips handler bodies from
 * the client build, so `env/server`'s Effect graph never ships. Every field
 * stays undefined when its variable is unset, which keeps both vendors
 * inactive on a provider-light deployment.
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
  const { readClientTelemetryConfig } = await import('./telemetry-config.effects')
  return readClientTelemetryConfig()
})
