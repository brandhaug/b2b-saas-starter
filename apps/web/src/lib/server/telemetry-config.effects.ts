import { hasValue } from '@b2b-saas-starter/env/server'
import { env as cloudflareEnv } from 'cloudflare:workers'

import { type ClientTelemetryConfig } from './telemetry-config'

/**
 * The telemetry config's server-only read, reached only through dynamic
 * `import()` inside the handler of `telemetry-config.ts` (see
 * apps/web/AGENTS.md). The `env/server` import pins the Effect graph, which
 * must never ship to the browser.
 */

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
export function readClientTelemetryConfigHandler(): ClientTelemetryConfig {
  return {
    // DSNs and PostHog project keys are public ingest identifiers by design;
    // no secret ever reaches this object.
    sentryDsn: nonEmptyEnvValue(cloudflareEnv.SENTRY_DSN),
    posthogKey: nonEmptyEnvValue(cloudflareEnv.POSTHOG_KEY),
    posthogHost: nonEmptyEnvValue(cloudflareEnv.POSTHOG_HOST)
  }
}
