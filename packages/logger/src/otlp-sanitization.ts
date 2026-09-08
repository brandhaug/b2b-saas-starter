// OTLP is a vendor wire format; this serializer handles only its structural fields and scalar attributes.
// oxlint-disable anti-slop/no-runtime-typeof, effect/noGlobals
import { Layer } from 'effect'
import { HttpBody } from 'effect/unstable/http'
import { OtlpSerialization } from 'effect/unstable/observability'
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

export const SanitizedOtlpSerialization = Layer.succeed(
  OtlpSerialization.OtlpSerialization,
  {
    traces: body,
    logs: body,
    metrics: body
  }
)
