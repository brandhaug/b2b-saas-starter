import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  ownerActivationTestIdempotencyKey,
  TransactionalEmail,
  type TransactionalEmailEvidence
} from '@b2b-saas-starter/capabilities/notifications'
import {
  makeTransactionalEmailCapabilityLayer,
  type BookingProductEnv
} from '@b2b-saas-starter/capabilities/runtime'
import {
  liveMerchantContext,
  MerchantContext
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import { runMerchantRequest } from './merchant-session.ts'

const OwnerActivationTestInput = Schema.Struct({
  locale: Schema.Literals(['ro', 'en']),
  commandId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
})
const decodeInput = Schema.decodeUnknownSync(OwnerActivationTestInput)

const emailEnv = (): BookingProductEnv & { readonly ENVIRONMENT?: string } => ({
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
  ...(env.ENVIRONMENT ? { ENVIRONMENT: env.ENVIRONMENT } : {})
})

export const sendOwnerActivationTestEmail = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decodeInput(input))
  .handler(
    async ({ data }): Promise<TransactionalEmailEvidence> =>
      runMerchantRequest('publication.update', (session) => {
        const merchantContext = liveMerchantContext(session.user.id).pipe(
          Layer.provide(layerFromD1(env.DB))
        )
        return Effect.runPromise(
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            const email = yield* TransactionalEmail
            return yield* email.sendOwnerActivationTest({
              merchantId: merchant.id,
              ownerUserId: session.user.id,
              verifiedOwnerEmail: null,
              locale: data.locale,
              idempotencyKey: ownerActivationTestIdempotencyKey(
                merchant.id,
                data.commandId
              ),
              now: new Date().toISOString()
            })
          }).pipe(
            Effect.provide(
              Layer.merge(
                merchantContext,
                makeTransactionalEmailCapabilityLayer(emailEnv())
              )
            )
          )
        )
      })
  )

export const getOwnerActivationTestEmailAttempt = createServerFn({
  method: 'GET'
}).handler(async () =>
  runMerchantRequest('publication.update', (session) => {
    const merchantContext = liveMerchantContext(session.user.id).pipe(
      Layer.provide(layerFromD1(env.DB))
    )
    return Effect.runPromise(
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const email = yield* TransactionalEmail
        const attempt = yield* email.ownerActivationTestAttempt({
          merchantId: merchant.id,
          now: new Date().toISOString()
        })
        return attempt
      }).pipe(
        Effect.provide(
          Layer.merge(
            merchantContext,
            makeTransactionalEmailCapabilityLayer(emailEnv())
          )
        )
      )
    )
  })
)
