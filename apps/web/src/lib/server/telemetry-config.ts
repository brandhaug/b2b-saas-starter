import { env as cloudflareEnv } from 'cloudflare:workers'

/**
 * The public, non-secret subset of the observability provider env the browser
 * SDKs need. Served to the client through the root route's loader; every field
 * stays undefined when its variable is unset, which keeps both vendors
 * inactive on a provider-light deployment.
 */
export type ClientTelemetryConfig = {
  readonly sentryDsn: string | undefined
  readonly posthogKey: string | undefined
  readonly posthogHost: string | undefined
}

/** Absent and empty both count as unset — no empty-string DSNs reach an SDK. */
function nonEmptyEnvValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value.length === 0) {
    return undefined
  }
  return value
}

/** Runs on the server only — it reads the worker's env bag. */
export function readClientTelemetryConfig(): ClientTelemetryConfig {
  return {
    // DSNs and PostHog project keys are public ingest identifiers by design;
    // no secret ever reaches this object.
    sentryDsn: nonEmptyEnvValue(cloudflareEnv.SENTRY_DSN),
    posthogKey: nonEmptyEnvValue(cloudflareEnv.POSTHOG_KEY),
    posthogHost: nonEmptyEnvValue(cloudflareEnv.POSTHOG_HOST)
  }
}
