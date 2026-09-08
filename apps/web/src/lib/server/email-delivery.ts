import { createServerFn } from '@tanstack/react-start'
import { type EmailDeliveryRecord } from '@b2b-saas-starter/email-delivery/email-delivery'

export type EmailDeliveryRow = EmailDeliveryRecord & {
  readonly unconfirmed: boolean
  readonly resendAllowed: boolean
}

export const loadOwnEmailDeliveryServerFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { loadOwnEmailDeliveryHandler } = await import('./email-delivery.effects')
    return loadOwnEmailDeliveryHandler()
  }
)

export const loadSystemEmailDeliveryServerFn = createServerFn({
  method: 'GET'
}).handler(async () => {
  const { loadSystemEmailDeliveryHandler } = await import('./email-delivery.effects')
  return loadSystemEmailDeliveryHandler()
})
