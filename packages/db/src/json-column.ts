// oxlint-disable effect/noThrowStatement -- Drizzle requires synchronous codecs; orUnavailable translates only this sanitized codec error into the typed channel.
import { customType } from 'drizzle-orm/sqlite-core'
import { Result, Schema } from 'effect'
import { PersistenceDecodeError } from '@b2b-saas-starter/failure/persistence'

/** Validate both driver directions without retaining rejected values in errors. */
export function jsonText<A>(
  table: string,
  column: string,
  schema: Schema.Codec<A, unknown>,
  acceptSerialized = false
) {
  const json = Schema.fromJsonString(schema)
  const decode = Schema.decodeUnknownResult(json)
  let validate = Schema.decodeUnknownResult(schema)
  if (acceptSerialized) {
    validate = Schema.decodeUnknownResult(Schema.Union([schema, json]))
  }
  const encode = Schema.encodeResult(json)
  const context = `${table}.${column}`
  return customType<{ data: A; driverData: string }>({
    dataType: () => 'text',
    fromDriver: (value) => {
      const result = decode(value)
      if (Result.isFailure(result)) {
        throw new PersistenceDecodeError({ column: context, operation: 'read' })
      }
      return result.success
    },
    toDriver: (value) => {
      // Better Auth's SQLite adapter pre-serializes array fields.
      const validated = validate(value)
      if (Result.isFailure(validated)) {
        throw new PersistenceDecodeError({ column: context, operation: 'write' })
      }
      const result = encode(validated.success)
      if (Result.isFailure(result)) {
        throw new PersistenceDecodeError({ column: context, operation: 'write' })
      }
      return result.success
    }
  })(column)
}
