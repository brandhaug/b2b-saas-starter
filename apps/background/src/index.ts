import { Effect, Layer, ManagedRuntime, Result } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import {
  makeOperationalMessagingExecutionLayer,
  selectCapabilitiesLayer,
  type BookingProductEnv
} from '@b2b-saas-starter/capabilities/runtime'
import {
  AvailabilityOfferEmail,
  EmailDispatcher,
  selectEmailDispatcherLayer,
  type SendEmailBinding
} from '@b2b-saas-starter/email'
import { WideEventLoggerLive, withTriggerScope } from '@b2b-saas-starter/logger'
import { processBookingOutbox, recoverBookingOutbox } from './booking-notifications.ts'
import { WaitingList } from '@b2b-saas-starter/capabilities/waiting-list'
import { WalkIns } from '@b2b-saas-starter/capabilities/walk-ins'
import { ShopTopology } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { GiftCardRedemptions } from '@b2b-saas-starter/capabilities/gift-cards'
import { createDb } from '@b2b-saas-starter/db/client'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { makeOperationsNotificationOutboxLayer } from '@b2b-saas-starter/capabilities/operations'
import {
  processOperationsNotification,
  recoverOperationsNotifications
} from './operations-notifications.ts'
import { decodeBookingEventsWakeup } from './booking-events-queue.ts'
import {
  LiveOperationalMessagingJobs,
  NotificationIntentExecution,
  NotificationIntentLifecycle,
  OperationalMessagingJobs
} from '@b2b-saas-starter/capabilities/notifications'
import {
  pollLiveSmsoStatuses,
  selectConfiguredSmsoAdapter
} from '@b2b-saas-starter/capabilities/notifications/providers/smso'

type Env = {
  readonly DB: D1Database
  readonly BOOKING_EVENTS_QUEUE?: Queue
  readonly CONFIRMATION_CURRENT_KEY_ID?: string
  readonly CONFIRMATION_SIGNING_KEYS?: string
  readonly PUBLIC_SITE_ORIGIN?: string
  readonly EMAIL?: SendEmailBinding
  readonly CLOUDFLARE_EMAIL_FROM?: string
  readonly OPERATIONAL_EMAIL_ENABLED?: string
  readonly ENVIRONMENT?: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY?: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY?: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION?: string
  readonly SMSO_API_KEY?: string
  readonly SMSO_SENDER_ID?: string
  readonly SMSO_CALLBACK_URL?: string
  readonly SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY?: string
  readonly SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY?: string
  readonly SMSO_PROVIDER_REFERENCE_KEY_VERSION?: string
  readonly META_WHATSAPP_ACCESS_TOKEN?: string
  readonly META_WHATSAPP_PHONE_NUMBER_ID?: string
  readonly META_WHATSAPP_GRAPH_API_VERSION?: string
  readonly META_WHATSAPP_PROVIDER_ACCOUNT_KEY?: string
  readonly META_WHATSAPP_REFERENCE_ENCRYPTION_KEY?: string
  readonly META_WHATSAPP_REFERENCE_FINGERPRINT_KEY?: string
  readonly META_WHATSAPP_REFERENCE_KEY_VERSION?: string
  readonly WAITING_LIST_DELIVERY_CURRENT_KEY_ID?: string
  readonly WAITING_LIST_DELIVERY_LEGACY_KEY_ID?: string
  readonly WAITING_LIST_DELIVERY_KEYS?: string
}

const BOOKING_EVENTS_QUEUE = 'b2b-saas-starter-booking-events'
const runtime = ManagedRuntime.make(
  Layer.mergeAll(FetchHttpClient.layer, WideEventLoggerLive)
)
const capabilitiesEnv = (env: Env): BookingProductEnv => ({
  DB: env.DB,
  OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY:
    env.OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY,
  OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY:
    env.OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY,
  OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION:
    env.OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION,
  SMSO_API_KEY: env.SMSO_API_KEY,
  SMSO_SENDER_ID: env.SMSO_SENDER_ID,
  SMSO_CALLBACK_URL: env.SMSO_CALLBACK_URL,
  SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY: env.SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY,
  SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY: env.SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY,
  SMSO_PROVIDER_REFERENCE_KEY_VERSION: env.SMSO_PROVIDER_REFERENCE_KEY_VERSION,
  META_WHATSAPP_ACCESS_TOKEN: env.META_WHATSAPP_ACCESS_TOKEN,
  META_WHATSAPP_PHONE_NUMBER_ID: env.META_WHATSAPP_PHONE_NUMBER_ID,
  META_WHATSAPP_GRAPH_API_VERSION: env.META_WHATSAPP_GRAPH_API_VERSION,
  META_WHATSAPP_PROVIDER_ACCOUNT_KEY: env.META_WHATSAPP_PROVIDER_ACCOUNT_KEY,
  META_WHATSAPP_REFERENCE_ENCRYPTION_KEY: env.META_WHATSAPP_REFERENCE_ENCRYPTION_KEY,
  META_WHATSAPP_REFERENCE_FINGERPRINT_KEY: env.META_WHATSAPP_REFERENCE_FINGERPRINT_KEY,
  META_WHATSAPP_REFERENCE_KEY_VERSION: env.META_WHATSAPP_REFERENCE_KEY_VERSION
})

const bookingConfig = (env: Env) => {
  let keys: Record<string, string> = {}
  try {
    keys = JSON.parse(env.CONFIRMATION_SIGNING_KEYS ?? '{}') as Record<string, string>
  } catch {
    // An invalid keyring is recorded as a terminal channel outcome.
  }
  return {
    publicOrigin: env.PUBLIC_SITE_ORIGIN ?? 'http://localhost:3071',
    emailProviderState:
      env.OPERATIONAL_EMAIL_ENABLED === 'false'
        ? ('disabled' as const)
        : env.EMAIL && env.CLOUDFLARE_EMAIL_FROM
          ? ('configured' as const)
          : ('needs_configuration' as const),
    confirmationKeyring: {
      currentKeyId: env.CONFIRMATION_CURRENT_KEY_ID ?? 'unconfigured',
      keys
    }
  }
}

const processBookingNotificationOutbox = (outboxId: string, now: string, env: Env) =>
  withTriggerScope(
    {
      service: 'background',
      event: 'booking_notification',
      env,
      metadata: { outboxId }
    },
    processBookingOutbox({
      outboxId,
      now,
      ...bookingConfig(env),
      ...(env.BOOKING_EVENTS_QUEUE
        ? {
            scheduleRetry: (id: string, delaySeconds: number) =>
              env.BOOKING_EVENTS_QUEUE!.send(
                { version: 1, kind: 'booking-outbox', outboxId: id },
                { delaySeconds }
              )
          }
        : {})
    }).pipe(
      Effect.provide(selectCapabilitiesLayer(capabilitiesEnv(env))),
      Effect.provide(
        selectEmailDispatcherLayer({
          ...(env.EMAIL ? { EMAIL: env.EMAIL } : {}),
          ...(env.CLOUDFLARE_EMAIL_FROM
            ? { EMAIL_FROM_ADDRESS: env.CLOUDFLARE_EMAIL_FROM }
            : {})
        })
      )
    )
  )

const recoverBookingNotificationOutbox = (now: string, env: Env) =>
  recoverBookingOutbox(now).pipe(
    Effect.provide(selectCapabilitiesLayer(capabilitiesEnv(env))),
    Effect.flatMap((ids) =>
      Effect.forEach(
        ids,
        (outboxId) => processBookingNotificationOutbox(outboxId, now, env),
        {
          concurrency: 4
        }
      )
    ),
    Effect.asVoid
  )

const notificationIntentExecutionLayer = (env: Env, now: string) =>
  makeOperationalMessagingExecutionLayer(
    { ...capabilitiesEnv(env), ENVIRONMENT: env.ENVIRONMENT },
    now
  )

const pollSmsoProviderStatuses = (env: Env, now: string, intentId?: string) => {
  const adapter = selectConfiguredSmsoAdapter(env, now)
  if (!adapter) return Effect.void
  return Effect.flatMap(NotificationIntentLifecycle, (lifecycle) =>
    pollLiveSmsoStatuses({
      db: env.DB,
      adapter,
      lifecycle,
      environment: env.ENVIRONMENT ?? 'production',
      providerAccountKey: 'platform-smso',
      encryptionSecret: env.SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY!,
      keyVersion: adapter.providerReferenceKeyVersion,
      ...(intentId ? { intentId, limit: 1 } : { limit: 100 })
    })
  ).pipe(Effect.asVoid)
}

const operationalMessagingLayer = (env: Env, now: string) =>
  Layer.merge(
    notificationIntentExecutionLayer(env, now),
    selectCapabilitiesLayer(capabilitiesEnv(env))
  )

const processNotificationIntent = (intentId: string, now: string, env: Env) =>
  withTriggerScope(
    {
      service: 'background',
      event: 'operational_messaging_intent',
      env,
      metadata: { intentId }
    },
    Effect.andThen(
      pollSmsoProviderStatuses(env, now, intentId),
      Effect.flatMap(NotificationIntentExecution, (execution) =>
        execution.execute({ intentId, now })
      )
    ).pipe(Effect.provide(operationalMessagingLayer(env, now)))
  )

const recoverNotificationIntents = (now: string, env: Env) =>
  Effect.andThen(
    pollSmsoProviderStatuses(env, now),
    Effect.flatMap(NotificationIntentExecution, (execution) =>
      Effect.flatMap(
        execution.discoverDue({ now, limit: 100, perShopLimit: 10 }),
        (intentIds) =>
          Effect.forEach(
            intentIds,
            (intentId) => processNotificationIntent(intentId, now, env),
            { concurrency: 1, discard: true }
          )
      )
    )
  ).pipe(Effect.provide(operationalMessagingLayer(env, now)), Effect.asVoid)

const reconcileAndRetainOperationalMessaging = (now: string, env: Env) =>
  Effect.gen(function* () {
    const jobs = yield* OperationalMessagingJobs
    const ownerId = `background:${crypto.randomUUID()}`
    yield* jobs.reconcile({ now, ownerId, limit: 100 })
    yield* jobs.scheduleRetention({ now, limit: 100 })
    yield* jobs.processRetention({ now, ownerId, limit: 100 })
  }).pipe(
    Effect.provide(
      LiveOperationalMessagingJobs.pipe(Layer.provide(layerFromD1(env.DB)))
    ),
    Effect.asVoid
  )

const operationsEmailProviderState = (env: Env) =>
  env.EMAIL && env.CLOUDFLARE_EMAIL_FROM
    ? ('configured' as const)
    : env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test'
      ? ('capture' as const)
      : ('needs_configuration' as const)

const operationsNotificationLayer = (env: Env) =>
  makeOperationsNotificationOutboxLayer(createDb(env.DB))

const processOperationsNotificationIntent = (intentId: string, now: string, env: Env) =>
  processOperationsNotification({
    intentId,
    now,
    providerState: operationsEmailProviderState(env)
  }).pipe(
    Effect.provide(operationsNotificationLayer(env)),
    Effect.provide(
      selectEmailDispatcherLayer({
        ...(env.EMAIL ? { EMAIL: env.EMAIL } : {}),
        ...(env.CLOUDFLARE_EMAIL_FROM
          ? { EMAIL_FROM_ADDRESS: env.CLOUDFLARE_EMAIL_FROM }
          : {})
      })
    )
  )

const recoverOperationsNotificationIntents = (now: string, env: Env) =>
  recoverOperationsNotifications(now).pipe(
    Effect.provide(operationsNotificationLayer(env)),
    Effect.flatMap((ids) =>
      Effect.forEach(
        ids,
        (intentId) => processOperationsNotificationIntent(intentId, now, env),
        { concurrency: 4 }
      )
    ),
    Effect.asVoid
  )

export default {
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const now = new Date(event.scheduledTime).toISOString()
    const capabilityLayer = selectCapabilitiesLayer(capabilitiesEnv(env))
    await env.DB.prepare(
      "UPDATE notification_intents SET status = 'failed', updated_at = ? WHERE source_type = 'availability-offer' AND status = 'processing' AND updated_at < ?"
    )
      .bind(now, new Date(Date.parse(now) - 5 * 60_000).toISOString())
      .run()
    await runtime.runPromise(
      withTriggerScope(
        { service: 'background', event: 'booking_recovery', env },
        Effect.flatMap(
          Effect.flatMap(WaitingList, (waitingList) => waitingList.expire(now)).pipe(
            Effect.provide(capabilityLayer)
          ),
          () =>
            Effect.all(
              [
                recoverBookingNotificationOutbox(now, env),
                recoverNotificationIntents(now, env),
                reconcileAndRetainOperationalMessaging(now, env),
                recoverOperationsNotificationIntents(now, env),
                Effect.flatMap(GiftCardRedemptions, (giftCards) =>
                  giftCards.releaseExpired({ now })
                ).pipe(Effect.provide(capabilityLayer), Effect.asVoid),
                Effect.gen(function* () {
                  const waitingList = yield* WaitingList
                  const email = yield* EmailDispatcher
                  let keys: Record<string, string> = {}
                  try {
                    keys = JSON.parse(env.WAITING_LIST_DELIVERY_KEYS ?? '{}') as Record<
                      string,
                      string
                    >
                  } catch {
                    // Missing/invalid keyrings fail through the capability.
                  }
                  const offers = yield* waitingList.deliverAvailable(now, {
                    currentKeyId:
                      env.WAITING_LIST_DELIVERY_CURRENT_KEY_ID ?? 'unconfigured',
                    legacyKeyId: env.WAITING_LIST_DELIVERY_LEGACY_KEY_ID ?? 'legacy',
                    keys
                  })
                  yield* Effect.forEach(offers, (delivery) =>
                    Effect.gen(function* () {
                      const claimed = yield* waitingList.claimOfferDelivery(
                        delivery.offer.id,
                        now
                      )
                      if (!claimed) return
                      yield* email.send({
                        idempotencyKey: `availability-offer:${delivery.offer.id}`,
                        from: env.CLOUDFLARE_EMAIL_FROM ?? '',
                        to: delivery.customer.email,
                        subject: 'A requested time is available',
                        element: AvailabilityOfferEmail({
                          startsAt: delivery.offer.slot.startsAt,
                          offerUrl: `${env.PUBLIC_SITE_ORIGIN ?? 'http://localhost:3071'}/${delivery.merchantSlug}/booking/waiting-list/${delivery.offer.applicationId}/offers/${delivery.offer.id}?capability=${encodeURIComponent(delivery.capability)}`
                        })
                      })
                      yield* Effect.promise(() =>
                        env.DB.prepare(
                          "UPDATE notification_intents SET status = 'delivered', updated_at = ? WHERE source_type = 'availability-offer' AND source_id = ? AND status = 'processing'"
                        )
                          .bind(now, delivery.offer.id)
                          .run()
                      )
                    }).pipe(
                      Effect.tapError(() =>
                        Effect.promise(() =>
                          env.DB.prepare(
                            "UPDATE notification_intents SET status = 'failed', updated_at = ? WHERE source_type = 'availability-offer' AND source_id = ? AND status = 'processing'"
                          )
                            .bind(now, delivery.offer.id)
                            .run()
                        )
                      )
                    )
                  )
                }).pipe(
                  Effect.provide(capabilityLayer),
                  Effect.provide(
                    selectEmailDispatcherLayer({
                      ...(env.EMAIL ? { EMAIL: env.EMAIL } : {}),
                      ...(env.CLOUDFLARE_EMAIL_FROM
                        ? { EMAIL_FROM_ADDRESS: env.CLOUDFLARE_EMAIL_FROM }
                        : {})
                    })
                  )
                ),
                Effect.gen(function* () {
                  const topology = yield* ShopTopology
                  const walkIns = yield* WalkIns
                  const shops = yield* topology.listAll()
                  yield* Effect.forEach(
                    shops,
                    (shop) => walkIns.expireEntries({ shopId: shop.id, now }),
                    { concurrency: 4 }
                  )
                }).pipe(Effect.provide(capabilityLayer))
              ],
              { concurrency: 3 }
            )
        ).pipe(Effect.asVoid)
      )
    )
  },
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (batch.queue !== BOOKING_EVENTS_QUEUE) {
      for (const message of batch.messages) message.ack()
      return
    }
    for (let offset = 0; offset < batch.messages.length; offset += 1) {
      const messages = batch.messages.slice(offset, offset + 1)
      await Promise.all(
        messages.map(async (message) => {
          const wakeup = decodeBookingEventsWakeup(message.body)
          if (!wakeup) {
            message.ack()
            return
          }
          const now = new Date().toISOString()
          const execution =
            wakeup.kind === 'notification-intent'
              ? processNotificationIntent(wakeup.intentId, now, env)
              : processBookingNotificationOutbox(wakeup.outboxId, now, env)
          const result = await runtime.runPromise(Effect.result(execution))
          if (Result.isSuccess(result)) message.ack()
          else message.retry({ delaySeconds: 30 })
        })
      )
    }
  }
}
