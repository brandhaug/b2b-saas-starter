import { Schema } from 'effect'

const BufferMinutes = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: 120 }),
  Schema.makeFilter((value: number) => value % 5 === 0)
)

export const ServiceBuffersInput = Schema.Struct({
  beforeBufferMinutes: BufferMinutes,
  afterBufferMinutes: BufferMinutes
})
export type ServiceBuffersInput = typeof ServiceBuffersInput.Type

const PersistedServiceBuffers = Schema.Struct({
  beforeBufferMinutes: Schema.optional(BufferMinutes),
  afterBufferMinutes: Schema.optional(BufferMinutes)
})

export type DecodedServiceBuffers = {
  readonly beforeBufferMinutes: number
  readonly afterBufferMinutes: number
}

/** Missing persisted fields retain the launch default; malformed values fail closed. */
export const decodePersistedServiceBuffers = (
  value: unknown
): DecodedServiceBuffers | null => {
  if (value === null || value === undefined)
    return { beforeBufferMinutes: 0, afterBufferMinutes: 0 }
  const decoded = Schema.decodeUnknownOption(PersistedServiceBuffers)(value)
  return decoded._tag === 'Some'
    ? {
        beforeBufferMinutes: decoded.value.beforeBufferMinutes ?? 0,
        afterBufferMinutes: decoded.value.afterBufferMinutes ?? 0
      }
    : null
}
