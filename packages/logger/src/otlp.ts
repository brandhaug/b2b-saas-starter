import { Duration, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { Otlp } from 'effect/unstable/observability'

import { readWideEventEnvironment } from './environment.ts'

export type ObservabilityEnv = {
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string | undefined
  readonly OTEL_EXPORTER_OTLP_HEADERS?: string | undefined
  readonly SERVICE_VERSION?: string | undefined
  readonly ENVIRONMENT?: string | undefined
  readonly GIT_COMMIT_SHA?: string | undefined
}

/** Parses the OTLP `key=value,key=value` header form used by the OTel spec. */
function otlpHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined
  const entries = value.split(',').flatMap((entry) => {
    const separator = entry.indexOf('=')
    if (separator <= 0) return []
    const key = entry.slice(0, separator).trim()
    const headerValue = entry.slice(separator + 1).trim()
    if (key.length === 0 || headerValue.length === 0) return []
    return [[key, headerValue]]
  })
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

/**
 * The three OTel resource attributes this starter sets, by their semantic-
 * convention names. A closed shape rather than an attribute bag: the deployment
 * identity the wide event carries is a fixed set, and the two optional keys are
 * assigned only when their env var is present.
 */
type OtelResourceAttributes = {
  'cloud.provider': string
  'deployment.environment.name'?: string
  'vcs.ref.head.revision'?: string
}

/** OTel resource attributes, from the same env fields the wide event reads. */
function resourceAttributes(env: ObservabilityEnv): OtelResourceAttributes {
  const environment = readWideEventEnvironment(env)
  const attributes: OtelResourceAttributes = { 'cloud.provider': 'cloudflare' }
  if (environment.environment) {
    attributes['deployment.environment.name'] = environment.environment
  }
  if (environment.commitHash) {
    attributes['vcs.ref.head.revision'] = environment.commitHash
  }
  return attributes
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
  if (!endpoint) return Layer.empty
  return Otlp.layerJson({
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
  }).pipe(Layer.provide(FetchHttpClient.layer))
}
