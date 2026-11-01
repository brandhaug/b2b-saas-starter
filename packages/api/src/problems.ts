import { Effect, Schema, SchemaGetter } from 'effect'
import { HttpApiError, HttpApiSchema } from 'effect/http-api'

const decodeStatus = Schema.decodeUnknownSync(
  Schema.Struct({ httpApiStatus: Schema.Number })
)

/** Public REST projection. Domain errors keep their identity and safe extensions. */
export function publicProblem<
  S extends Schema.Top & {
    readonly fields: Schema.Struct.Fields
    readonly identifier: string
    readonly Encoded: Readonly<Record<string, unknown>>
  }
>(schema: S, status = decodeStatus(schema.ast.annotations).httpApiStatus) {
  const type = `urn:b2b-saas-starter:problem:${schema.identifier}`
  const title = schema.identifier.replaceAll(/([a-z])([A-Z])/g, '$1 $2')
  // Reuse Effect's RFC members, including lenient status/title decoding. The
  // projection decodes back to the capability class rather than a second error.
  const problem = HttpApiError.Problem<Schema.JsonObject>()(schema.identifier, {
    type,
    status,
    title
  })
  const wire = Schema.Struct({ ...schema.fields, ...problem.fields })
  const decodeError = Schema.decodeUnknownEffect(Schema.toEncoded(schema))
  return wire.pipe(
    Schema.decodeTo(schema, {
      decode: SchemaGetter.transformEffect((body) =>
        decodeError(body).pipe(Effect.mapError((error) => error.issue))
      ),
      encode: SchemaGetter.transform((body: S['Encoded']) => {
        const encoded = { ...body, type, status, title }
        if (
          schema.identifier === 'CapabilityUnavailable' ||
          schema.identifier === 'AssistantUnavailable'
        ) {
          return { ...encoded, reason: 'Service temporarily unavailable' }
        }
        return encoded
      })
    }),
    HttpApiSchema.status(status),
    HttpApiSchema.asJson({ contentType: 'application/problem+json' })
  )
}
