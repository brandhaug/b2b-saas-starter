import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, notificationIntents } from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { NotificationIntentUnavailable, NotificationIntents } from './index.ts'

type Intent = typeof import('./index.ts').NotificationIntent.Type

export const SeedNotificationIntents = (
  records: readonly Intent[] = []
): Layer.Layer<NotificationIntents> =>
  Layer.succeed(NotificationIntents)({
    findById: (intentId) => {
      const intent = records.find((record) => record.id === intentId)
      return intent
        ? Effect.succeed(intent)
        : Effect.fail(new NotificationIntentUnavailable({ intentId }))
    }
  })

export const LiveNotificationIntents: Layer.Layer<
  NotificationIntents,
  never,
  Database
> = Layer.effect(
  NotificationIntents,
  Effect.gen(function* () {
    const db = yield* Database
    return {
      findById: (intentId) =>
        Effect.flatMap(
          orUnavailable('notification-intents')(
            db
              .select()
              .from(notificationIntents)
              .where(eq(notificationIntents.id, intentId))
              .limit(1)
          ),
          ([intent]) =>
            intent
              ? Effect.succeed({
                  id: intent.id,
                  shopId: intent.shopId,
                  topic: intent.topic,
                  sourceType: intent.sourceType,
                  sourceId: intent.sourceId,
                  ...(intent.sourceVersion === null
                    ? {}
                    : { sourceVersion: intent.sourceVersion }),
                  deduplicationKey: intent.deduplicationKey,
                  status: intent.status,
                  availableAt: intent.availableAt
                })
              : Effect.fail(new NotificationIntentUnavailable({ intentId }))
        )
    }
  })
)
