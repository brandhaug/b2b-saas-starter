// OTLP is a vendor wire format; this serializer handles only its structural fields and scalar attributes.
// oxlint-disable anti-slop/no-runtime-typeof, effect/noGlobals
import { Layer } from 'effect'
import { HttpBody } from 'effect/unstable/http'
import { OtlpSerialization, type OtlpResource } from 'effect/unstable/observability'
import { diagnosticFields, diagnosticLabel } from './sanitization.ts'

function sanitizeAttribute(value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('key' in value) ||
    typeof value.key !== 'string' ||
    !('value' in value) ||
    typeof value.value !== 'object' ||
    value.value === null
  ) {
    return []
  }
  const scalar = value.value
  let candidate: unknown
  if ('stringValue' in scalar) {
    candidate = scalar.stringValue
  } else if ('intValue' in scalar) {
    candidate = scalar.intValue
  } else if ('doubleValue' in scalar) {
    candidate = scalar.doubleValue
  } else if ('boolValue' in scalar) {
    candidate = scalar.boolValue
  }
  if (diagnosticFields({ [value.key]: candidate })[value.key] === undefined) {
    return []
  }
  return [{ key: value.key, value: scalar }]
}

/** Runs after Effect creates exception events, including nested causes and HttpClient failures. */
function body(data: unknown): HttpBody.HttpBody {
  return HttpBody.text(
    JSON.stringify(data, (key, value: unknown) => {
      if (key === 'attributes' || key === 'filteredAttributes') {
        if (!Array.isArray(value)) {
          return []
        }
        return value.flatMap(sanitizeAttribute)
      }
      if (key === 'body') {
        if (typeof value === 'object' && value !== null && 'stringValue' in value) {
          return { stringValue: diagnosticLabel(value.stringValue) }
        }
        return { stringValue: '[omitted]' }
      }
      if (key === 'message' || key === 'description' || key === 'schemaUrl') {
        return
      }
      if (key === 'name') {
        return diagnosticLabel(value)
      }
      return value
    }),
    'application/json'
  )
}

/** `event` is set on canonical log emissions, never inferred from arbitrary message text. */
function canonicalEvent(attributes: ReadonlyArray<OtlpResource.KeyValue>): string {
  return diagnosticLabel(
    attributes.find((entry) => entry.key === 'event')?.value.stringValue
  )
}

export const SanitizedOtlpSerialization = Layer.succeed(
  OtlpSerialization.OtlpSerialization,
  {
    traces: (data) =>
      body({
        ...data,
        resourceSpans: data.resourceSpans.map((resource) => ({
          ...resource,
          scopeSpans: resource.scopeSpans.map((scope) => ({
            ...scope,
            spans: scope.spans.map((span) => ({
              ...span,
              events: span.events.map((event) => {
                let name = canonicalEvent(event.attributes)
                if (event.name === 'exception') {
                  name = 'exception'
                }
                return { ...event, name }
              })
            }))
          }))
        }))
      }),
    logs: (data) =>
      body({
        ...data,
        resourceLogs: data.resourceLogs.map((resource) => ({
          ...resource,
          scopeLogs: resource.scopeLogs.map((scope) => ({
            ...scope,
            logRecords: scope.logRecords?.map((record) => ({
              ...record,
              body: { stringValue: canonicalEvent(record.attributes) }
            }))
          }))
        }))
      }),
    metrics: body
  }
)
