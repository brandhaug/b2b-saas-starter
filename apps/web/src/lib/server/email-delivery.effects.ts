import {
  EmailDelivery,
  isDeliveryUnconfirmed,
  canResendInvitation,
  type EmailDeliveryRecord
} from '@b2b-saas-starter/email-delivery/email-delivery'
import { adminSystemRole } from '@b2b-saas-starter/db/enums'
import { Clock, Effect } from 'effect'
import { runCapabilities } from '../capabilities'
import { requireRequestSession, UnauthorizedError } from './auth'

export const deliveryRows = Effect.fn('EmailDelivery.rows')(function* (
  records: ReadonlyArray<EmailDeliveryRecord>
) {
  const now = yield* Clock.currentTimeMillis
  return records.map((record) => ({
    ...record,
    resendAllowed: canResendInvitation(record),
    unconfirmed: isDeliveryUnconfirmed(record, now)
  }))
})

export async function loadOwnEmailDeliveryHandler() {
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.flatMap(EmailDelivery, (delivery) =>
      delivery.listForUser(session.user.id)
    ).pipe(Effect.flatMap(deliveryRows))
  )
}

export async function loadSystemEmailDeliveryHandler() {
  const session = await requireRequestSession()
  if (session.user.role !== adminSystemRole) {
    // oxlint-disable-next-line effect/noThrowStatement -- server-fn authorization refusal
    throw new UnauthorizedError()
  }
  return runCapabilities(
    Effect.flatMap(EmailDelivery, (delivery) => delivery.listSystem()).pipe(
      Effect.flatMap(deliveryRows)
    )
  )
}
