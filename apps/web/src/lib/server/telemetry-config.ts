import { hasValue } from '@b2b-saas-starter/env/server'
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

/**
 * Absent, null, and empty all count as unset — no empty-string DSNs reach an
 * SDK. (Worker env keys for unset optional providers arrive as `null` from
 * deploys that forward them explicitly, so `undefined` alone is not enough.)
 * The test itself is `hasValue` from `@b2b-saas-starter/env` — the one
 * "unset means inactive" rule; this only turns its verdict into the optional
 * string the client config carries.
 */
function nonEmptyEnvValue(value: string | null | undefined): string | undefined {
  return hasValue(value) ? value : undefined
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
