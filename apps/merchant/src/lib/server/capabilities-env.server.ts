import { env } from 'cloudflare:workers'
import type { BookingProductEnv } from '@b2b-saas-starter/capabilities/runtime'

export const merchantCapabilitiesEnv = (): BookingProductEnv & {
  readonly ENVIRONMENT?: string
} => ({
  DB: env.DB,
  ...(env.EMAIL
    ? {
        EMAIL: {
          send: (message) =>
            env.EMAIL!.send({
              from: message.from,
              to: typeof message.to === 'string' ? message.to : message.to.join(','),
              subject: message.subject,
              text: message.text ?? '',
              html: message.html ?? message.text ?? '',
              ...(message.headers ? { headers: message.headers } : {})
            })
        }
      }
    : {}),
  ...(env.CLOUDFLARE_EMAIL_FROM
    ? { CLOUDFLARE_EMAIL_FROM: env.CLOUDFLARE_EMAIL_FROM }
    : {}),
  ...(env.TRANSACTIONAL_EMAIL_SENDER_VERIFIED
    ? { TRANSACTIONAL_EMAIL_SENDER_VERIFIED: env.TRANSACTIONAL_EMAIL_SENDER_VERIFIED }
    : {}),
  ...(env.TRANSACTIONAL_EMAIL_CALLBACK_SECRET
    ? { TRANSACTIONAL_EMAIL_CALLBACK_SECRET: env.TRANSACTIONAL_EMAIL_CALLBACK_SECRET }
    : {}),
  ...(env.TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY
    ? {
        TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY:
          env.TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY
      }
    : {}),
  ...(env.TRANSACTIONAL_EMAIL_DISABLED
    ? { TRANSACTIONAL_EMAIL_DISABLED: env.TRANSACTIONAL_EMAIL_DISABLED }
    : {}),
  ...(env.CONFIRMATION_SIGNING_KEYS
    ? { CONFIRMATION_SIGNING_KEYS: env.CONFIRMATION_SIGNING_KEYS }
    : {}),
  ...(env.CONFIRMATION_CURRENT_KEY_ID
    ? { CONFIRMATION_CURRENT_KEY_ID: env.CONFIRMATION_CURRENT_KEY_ID }
    : {}),
  ...(env.PUBLIC_SITE_ORIGIN ? { PUBLIC_SITE_ORIGIN: env.PUBLIC_SITE_ORIGIN } : {}),
  ...(env.CUSTOMER_DIRECTORY_FINGERPRINT_KEY
    ? { CUSTOMER_DIRECTORY_FINGERPRINT_KEY: env.CUSTOMER_DIRECTORY_FINGERPRINT_KEY }
    : {}),
  ...(env.ENVIRONMENT ? { ENVIRONMENT: env.ENVIRONMENT } : {})
})
