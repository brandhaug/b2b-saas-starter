import { hasValue } from '@b2b-saas-starter/env/server'
import { env as cloudflareEnv } from 'cloudflare:workers'

import { type ClientTelemetryConfig } from './telemetry-config'

export function readClientTelemetryConfigHandler(): ClientTelemetryConfig {
  const name = nonEmptyEnvValue(cloudflareEnv.PRIVACY_CONTROLLER_NAME?.trim())
  const email = nonEmptyEnvValue(cloudflareEnv.PRIVACY_CONTACT_EMAIL?.trim())
  const privacyController =
    name && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? { name, email }
      : undefined
  return {
    privacyController,
    // Cloudflare's beacon token is a public ingest identifier, not an API secret.
    cloudflareWebAnalyticsToken: privacyController
      ? nonEmptyEnvValue(cloudflareEnv.CLOUDFLARE_WEB_ANALYTICS_TOKEN)
      : undefined
  }
}

// Forwarded Worker bindings can be null. Normalize all inactive provider values
// to undefined so SDKs never receive an empty-string key.
function nonEmptyEnvValue(value: string | null | undefined): string | undefined {
  return hasValue(value) ? value : undefined
}
