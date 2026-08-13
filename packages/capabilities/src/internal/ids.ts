import { Clock, Effect } from 'effect'
import { randomHex } from './crypto.ts'

/**
 * Mints a capability row id (`<prefix>_<millis>_<8-byte hex>`). The timestamp
 * comes from `Clock`, so `TestClock` controls generated ids in tests.
 */
export const newCapabilityId = Effect.fnUntraced(function* (prefix: string) {
  const millis = yield* Clock.currentTimeMillis
  return `${prefix}_${millis}_${randomHex(8)}`
})
