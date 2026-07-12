import { Effect, Layer, ManagedRuntime, Result } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import {
  selectCapabilitiesLayer,
  type BookingProductEnv
} from '@b2b-saas-starter/capabilities/runtime'
import {
  selectEmailDispatcherLayer,
  type SendEmailBinding
} from '@b2b-saas-starter/email'
import { WideEventLoggerLive, withTriggerScope } from '@b2b-saas-starter/logger'
import { processBookingOutbox, recoverBookingOutbox } from './booking-notifications.ts'

type Env = {
  readonly DB: D1Database
  readonly BOOKING_EVENTS_QUEUE?: Queue
  readonly CONFIRMATION_CURRENT_KEY_ID?: string
  readonly CONFIRMATION_SIGNING_KEYS?: string
  readonly PUBLIC_SITE_ORIGIN?: string
  readonly EMAIL?: SendEmailBinding
  readonly CLOUDFLARE_EMAIL_FROM?: string
  readonly OPERATIONAL_EMAIL_ENABLED?: string
}

const BOOKING_EVENTS_QUEUE = 'b2b-saas-starter-booking-events'
const runtime = ManagedRuntime.make(
  Layer.mergeAll(FetchHttpClient.layer, WideEventLoggerLive)
)
const capabilitiesEnv = (env: Env): BookingProductEnv => ({ DB: env.DB })

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
              env.BOOKING_EVENTS_QUEUE!.send({ outboxId: id }, { delaySeconds })
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

export default {
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await runtime.runPromise(
      withTriggerScope(
        { service: 'background', event: 'booking_recovery', env },
        recoverBookingNotificationOutbox(
          new Date(event.scheduledTime).toISOString(),
          env
        )
      )
    )
  },
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (batch.queue !== BOOKING_EVENTS_QUEUE) {
      for (const message of batch.messages) message.ack()
      return
    }
    await Promise.all(
      batch.messages.map(async (message) => {
        const body = message.body as { outboxId?: unknown }
        if (typeof body?.outboxId !== 'string') {
          message.ack()
          return
        }
        const result = await runtime.runPromise(
          Effect.result(
            processBookingNotificationOutbox(
              body.outboxId,
              new Date().toISOString(),
              env
            )
          )
        )
        if (Result.isSuccess(result)) message.ack()
        else message.retry({ delaySeconds: 30 })
      })
    )
  }
}
