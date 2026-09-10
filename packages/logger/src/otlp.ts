import { Duration, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { Otlp } from 'effect/unstable/observability'

import { hasValue, type ProviderEnvOf } from '@b2b-saas-starter/env/server'

import { readWideEventEnvironment } from './environment.ts'
import { SanitizedOtlpSerialization } from './otlp-sanitization.ts'

export type ObservabilityEnv = ProviderEnvOf<
  | 'OTEL_EXPORTER_OTLP_ENDPOINT'
  | 'OTEL_EXPORTER_OTLP_HEADERS'
  | 'SERVICE_VERSION'
  | 'ENVIRONMENT'
  | 'GIT_COMMIT_SHA'
>

/** Parses the OTLP `key=value,key=value` header form used by the OTel spec. */
function otlpHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!hasValue(value)) {
    return undefined
  }
  const headers = Object.fromEntries(
    value
      .split(',')
      .filter((entry) => entry.includes('='))
      .map((entry) => {
        // Split on the first `=` only: header values carry `=` themselves,
        // such as the padding on a base64 credential.
        const separator = entry.indexOf('=')
        return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()]
      })
      .filter(([key, headerValue]) => key && headerValue)
  )
  if (Object.keys(headers).length === 0) {
    return undefined
  }
  return headers
}

/** OTel resource attributes, from the same env fields the wide event reads. */
function resourceAttributes(env: ObservabilityEnv) {
  // A closed shape rather than an attribute bag: the deployment identity the
  // wide event carries is a fixed set, and the two optional keys are present
  // only when their env var is.
  const environment = readWideEventEnvironment(env)
  return {
    'cloud.provider': 'cloudflare',
    ...(environment.environment && {
      'deployment.environment.name': environment.environment
    }),
    ...(environment.commitHash && {
      'vcs.ref.head.revision': environment.commitHash
    })
  }
}

/**
 * OTLP export of traces, metrics, and the canonical log records. `Layer.empty`
 * when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, so the starter stays
 * provider-light: without a collector the console JSON event is still emitted
 * and nothing fails.
 *
 * **Provide this per invocation, never per isolate.** The exporters flush from
 * a background fiber and from a scope finalizer, and a Cloudflare Worker may
 * not perform I/O on behalf of a request that has already ended. An exporter
 * built once per isolate would therefore stop exporting after the request that
 * created it — silently. Every entry point builds this inside the invocation
 * (`Effect.provide(..., { local: true })`) so its scope closes, and the final
 * flush runs, while the invocation is still allowed to make requests.
 *
 * Provide it *inside* `WideEventLoggerLive`, never merged beside it:
 * `loggerMergeWithExisting` reads the loggers present when this layer builds,
 * so console JSON survives only if it is already in context by then.
 */
export function makeOtlpLayer(
  serviceName: string,
  env: ObservabilityEnv
): Layer.Layer<never> {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, '')
  if (!endpoint) {
    return Layer.empty
  }
  return Otlp.layer({
    baseUrl: endpoint,
    headers: otlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    resource: {
      serviceName,
      serviceVersion: env.SERVICE_VERSION,
      attributes: resourceAttributes(env)
    },
    // Keep the Cloudflare console JSON event as the canonical local record.
    loggerMergeWithExisting: true,
    // Invocation-scoped exporters: the periodic fibers rarely get a turn, so
    // keep the intervals short and let the shutdown flush do the real work.
    loggerExportInterval: Duration.seconds(1),
    metricsExportInterval: Duration.seconds(1),
    tracerExportInterval: Duration.seconds(1),
    shutdownTimeout: Duration.seconds(3)
  }).pipe(Layer.provide([FetchHttpClient.layer, SanitizedOtlpSerialization]))
}
