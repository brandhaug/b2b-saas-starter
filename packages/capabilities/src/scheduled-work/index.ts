import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { ScheduledWorkId, ShopId } from '../ids.ts'

export const ScheduledWork = Schema.Struct({
  id: ScheduledWorkId,
  shopId: Schema.NullOr(ShopId),
  kind: Schema.String,
  sourceType: Schema.optional(Schema.String),
  sourceId: Schema.optional(Schema.String),
  sourceVersion: Schema.optional(Schema.Number),
  idempotencyKey: Schema.String,
  status: Schema.Literals(['pending', 'running', 'completed', 'cancelled', 'failed']),
  runAt: Schema.String,
  attempts: Schema.Number
})
export class ScheduledWorkConflict extends Schema.TaggedErrorClass<ScheduledWorkConflict>()(
  'ScheduledWorkConflict',
  { idempotencyKey: Schema.String }
) {}

export class ScheduledWorkNotFound extends Schema.TaggedErrorClass<ScheduledWorkNotFound>()(
  'ScheduledWorkNotFound',
  { workId: ScheduledWorkId }
) {}

export type ScheduledWorkQueueShape = {
  readonly findById: (
    workId: string
  ) => Effect.Effect<
    typeof ScheduledWork.Type,
    ScheduledWorkNotFound | CapabilityUnavailable
  >
}

export class ScheduledWorkQueue extends Context.Service<
  ScheduledWorkQueue,
  ScheduledWorkQueueShape
>()('@b2b-saas-starter/capabilities/ScheduledWorkQueue') {}
