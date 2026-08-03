import { Schema } from 'effect'
import {
  BookingEventsWakeupSchema,
  type BookingEventsWakeup
} from '@b2b-saas-starter/capabilities/notifications'
import {
  QueueWakeup,
  type QueueWakeup as CapabilityQueueWakeup
} from '@b2b-saas-starter/capabilities/foundation'

const legacyOutboxWakeup = Schema.Struct({
  outboxId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
})

/**
 * Accepts the versioned PII-free envelope and the temporary legacy outbox shape.
 * Unknown versions and extra business payloads never reach a capability.
 */
export const decodeBookingEventsWakeup = (
  value: unknown
): BookingEventsWakeup | CapabilityQueueWakeup | null => {
  const capability = Schema.decodeUnknownOption(QueueWakeup)(value)
  if (capability._tag === 'Some') return capability.value
  const current = Schema.decodeUnknownOption(BookingEventsWakeupSchema)(value)
  if (current._tag === 'Some') return current.value
  const legacy = Schema.decodeUnknownOption(legacyOutboxWakeup)(value)
  return legacy._tag === 'Some'
    ? { version: 1, kind: 'booking-outbox', outboxId: legacy.value.outboxId }
    : null
}
