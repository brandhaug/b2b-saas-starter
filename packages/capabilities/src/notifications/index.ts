import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { NotificationIntentId, ShopId } from '../ids.ts'

export const NotificationIntent = Schema.Struct({
  id: NotificationIntentId,
  shopId: ShopId,
  topic: Schema.String,
  sourceType: Schema.String,
  sourceId: Schema.String,
  sourceVersion: Schema.optional(Schema.Number),
  deduplicationKey: Schema.String,
  status: Schema.Literals([
    'pending',
    'processing',
    'delivered',
    'failed',
    'cancelled'
  ]),
  availableAt: Schema.String
})
export class NotificationIntentUnavailable extends Schema.TaggedErrorClass<NotificationIntentUnavailable>()(
  'NotificationIntentUnavailable',
  { intentId: Schema.String }
) {}

export type NotificationIntentsShape = {
  readonly findById: (
    intentId: string
  ) => Effect.Effect<
    typeof NotificationIntent.Type,
    NotificationIntentUnavailable | CapabilityUnavailable
  >
}

export class NotificationIntents extends Context.Service<
  NotificationIntents,
  NotificationIntentsShape
>()('@b2b-saas-starter/capabilities/NotificationIntents') {}
