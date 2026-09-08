// Telemetry accepts unknown SDK values. Only primitive, explicitly allowed fields leave this module.
// oxlint-disable anti-slop/no-runtime-typeof
import { type ErrorEvent } from '@sentry/cloudflare'

const OMITTED = '[omitted]'

/** Code-owned labels only. URLs, query strings, whitespace and email addresses are rejected. */
export function diagnosticLabel(value: unknown): string {
  if (typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/.test(value)) {
    return value
  }
  return OMITTED
}

const allowedFields = new Set([
  'service',
  'event',
  'status',
  'outcome',
  'errorKind',
  'errorTag',
  'environment',
  'region',
  'serviceVersion',
  'commitHash',
  'method',
  'handlerType',
  'scope',
  'unreadCount',
  'traceId',
  'otelTraceId',
  'otelSpanId',
  'spanId',
  'workspaceId',
  'exportId',
  'deliveryId',
  'endpointId',
  'webhookEndpointId',
  'jobId',
  'evidenceId',
  'evidenceKind',
  'queue',
  'messageId',
  'attempts',
  'ageMs',
  'rateLimitDegraded',
  'rateLimitFallback',
  'rateLimitBucket',
  'durationMs',
  'statusCode',
  'sizeBytes',
  'count',
  'attempt',
  'quantity',
  'authenticated',
  'credential',
  'authReason',
  'plan',
  'signal',
  'service.name',
  'service.version',
  'event.name',
  'cloud.provider',
  'deployment.environment.name',
  'vcs.ref.head.revision',
  'outcome.status',
  'duration.ms',
  'http.request.method',
  'http.response.status_code',
  'exception.type',
  'status.interrupted',
  'fiberId'
])

/** No recursion into arbitrary annotations: nested errors, headers and customer data are omitted. */
export function diagnosticFields(fields: object) {
  const result: Record<string, string | number | boolean> = {}
  for (const key of Object.keys(fields)) {
    const value: unknown = Object.getOwnPropertyDescriptor(fields, key)?.value
    if (key === 'handlerType' && value !== 'router' && value !== 'serverFn') {
      continue
    }
    if (key === 'scope' && value !== 'standalone') {
      continue
    }
    if (key === 'unreadCount' && typeof value !== 'number') {
      continue
    }
    if (!allowedFields.has(key)) {
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value
    } else if (typeof value === 'boolean') {
      result[key] = value
    } else if (typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,120}$/.test(value)) {
      result[key] = value
    }
  }
  return result
}

/** The web request's known nested-run list gets the same scalar allowlist, one level only. */
export function diagnosticAnnotations(fields: Readonly<Record<string, unknown>>) {
  const safe = diagnosticFields(fields)
  if (!Array.isArray(fields['nested'])) {
    return safe
  }
  return {
    ...safe,
    nested: fields['nested'].flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) {
        return []
      }
      return [diagnosticFields(entry)]
    })
  }
}

/** Rebuild the event so new SDK fields cannot silently expand data collection. */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  const trace = event.contexts?.trace
  const sanitized: ErrorEvent = {
    type: undefined,
    platform: 'javascript',
    release: diagnosticLabel(event.release),
    environment: diagnosticLabel(event.environment),
    message: 'Application failure',
    fingerprint: [
      'application',
      diagnosticLabel(event.tags?.['service']),
      diagnosticLabel(event.tags?.['event']),
      diagnosticLabel(event.tags?.['signal']),
      ...(event.exception?.values ?? []).map((exception) =>
        diagnosticLabel(exception.type)
      )
    ],
    tags: diagnosticFields(event.tags ?? {}),
    extra: diagnosticFields(event.extra ?? {}),

    exception: {
      values: (event.exception?.values ?? []).map((exception) => ({
        type: diagnosticLabel(exception.type),
        value: OMITTED
      }))
    }
  }
  if (
    trace &&
    /^[a-f0-9]{32}$/.test(trace.trace_id) &&
    /^[a-f0-9]{16}$/.test(trace.span_id)
  ) {
    sanitized.contexts = {
      trace: {
        trace_id: trace.trace_id,
        span_id: trace.span_id,
        op: diagnosticLabel(trace.op),
        status: diagnosticLabel(trace.status)
      }
    }
  }
  if (event.event_id !== undefined) {
    sanitized.event_id = event.event_id
  }
  if (event.timestamp !== undefined) {
    sanitized.timestamp = event.timestamp
  }
  if (event.level !== undefined) {
    sanitized.level = event.level
  }
  return sanitized
}

/** Shared by server and browser SDK initialization; OTLP remains the trace provider. */
export const sentryPrivacyOptions = {
  tracesSampleRate: 0,
  enableLogs: false,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
    frameContextLines: 0
  },
  beforeBreadcrumb: () => null,
  beforeSend: sanitizeSentryEvent,
  beforeSendTransaction: () => null
}
