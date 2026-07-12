import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { NotificationIntentId, ShopId, WalkInEntryId } from '../ids.ts'

export const WalkInStatus = Schema.Literals([
  'waiting',
  'called',
  'serving',
  'served',
  'removed',
  'expired'
])
export type WalkInStatus = typeof WalkInStatus.Type

export const WalkInConfiguration = Schema.Struct({
  shopId: ShopId,
  open: Schema.Boolean,
  eligibleServiceIds: Schema.Array(Schema.String),
  eligibleProviderIds: Schema.Array(Schema.String),
  averageServiceMinutes: Schema.Number.check(Schema.isGreaterThan(0)),
  acknowledgmentTtlMinutes: Schema.Number.check(Schema.isGreaterThan(0))
})
export type WalkInConfiguration = typeof WalkInConfiguration.Type
export const WalkInOption = Schema.Struct({ id: Schema.String, name: Schema.String })
export const WalkInOverview = Schema.Struct({
  state: Schema.Literals(['open', 'closed']),
  services: Schema.Array(WalkInOption),
  providers: Schema.Array(WalkInOption),
  queue: Schema.Array(Schema.suspend(() => WalkInQueueEntry))
})
export type WalkInOverview = typeof WalkInOverview.Type

export const WalkInHistoryEvent = Schema.Struct({
  from: Schema.NullOr(WalkInStatus),
  to: WalkInStatus,
  occurredAt: Schema.String
})

export const WalkInEntry = Schema.Struct({
  id: WalkInEntryId,
  shopId: ShopId,
  status: WalkInStatus,
  position: Schema.Number
})
export const WalkInQueueEntry = Schema.Struct({
  ...WalkInEntry.fields,
  projectedWaitMinutes: Schema.Number,
  serviceId: Schema.String,
  providerPreference: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('any') }),
    Schema.Struct({ kind: Schema.Literal('specific'), providerId: Schema.String })
  ]),
  locale: Schema.String,
  history: Schema.Array(WalkInHistoryEvent)
})
export type WalkInQueueEntry = typeof WalkInQueueEntry.Type
export class WalkInEntryNotFound extends Schema.TaggedErrorClass<WalkInEntryNotFound>()(
  'WalkInEntryNotFound',
  { entryId: WalkInEntryId }
) {}
export class WalkInsClosed extends Schema.TaggedErrorClass<WalkInsClosed>()(
  'WalkInsClosed',
  { shopId: ShopId }
) {}
export class WalkInUnavailable extends Schema.TaggedErrorClass<WalkInUnavailable>()(
  'WalkInUnavailable',
  { shopId: ShopId, reason: Schema.String }
) {}
export class WalkInDuplicate extends Schema.TaggedErrorClass<WalkInDuplicate>()(
  'WalkInDuplicate',
  { shopId: ShopId, entryId: WalkInEntryId }
) {}
export class WalkInTransitionRejected extends Schema.TaggedErrorClass<WalkInTransitionRejected>()(
  'WalkInTransitionRejected',
  { entryId: WalkInEntryId, from: WalkInStatus, to: WalkInStatus }
) {}

export const WalkInEnrollment = Schema.Struct({
  shopId: ShopId,
  serviceId: Schema.String,
  providerPreference: WalkInQueueEntry.fields.providerPreference,
  customerDetails: Schema.Struct({
    name: Schema.String.check(Schema.isMinLength(1)),
    email: Schema.String.check(Schema.isMinLength(3)),
    phone: Schema.String.check(Schema.isMinLength(5))
  }),
  locale: Schema.String
})
export type WalkInEnrollment = typeof WalkInEnrollment.Type
export const StoredWalkInRequest = Schema.Struct({
  serviceId: Schema.String,
  providerPreference: WalkInQueueEntry.fields.providerPreference,
  locale: Schema.String,
  contactKey: Schema.String
})
export type StoredWalkInRequest = typeof StoredWalkInRequest.Type
export type WalkInError =
  | WalkInEntryNotFound
  | WalkInsClosed
  | WalkInUnavailable
  | WalkInDuplicate
  | WalkInTransitionRejected
  | CapabilityUnavailable
export type WalkInAcknowledgment = {
  readonly entry: typeof WalkInQueueEntry.Type
  readonly acknowledgment: { readonly capability: string; readonly expiresAt: string }
  readonly notificationIntent: {
    readonly id: typeof NotificationIntentId.Type
    readonly topic: 'walk-in.enrolled'
    readonly sourceId: string
  }
}
export type WalkInsShape = {
  readonly findById: (input: {
    readonly shopId: string
    readonly entryId: string
  }) => Effect.Effect<
    typeof WalkInEntry.Type,
    WalkInEntryNotFound | CapabilityUnavailable
  >
  readonly inspect: (input: {
    readonly shopId: string
    readonly entryId: string
    readonly capability: string
  }) => Effect.Effect<typeof WalkInQueueEntry.Type, WalkInError>
  readonly queue: (
    shopId: string
  ) => Effect.Effect<readonly (typeof WalkInQueueEntry.Type)[], WalkInError>
  readonly overview: (shopId: string) => Effect.Effect<WalkInOverview, WalkInError>
  readonly enroll: (
    input: WalkInEnrollment
  ) => Effect.Effect<WalkInAcknowledgment, WalkInError>
  readonly transition: (input: {
    readonly shopId: string
    readonly entryId: string
    readonly to: WalkInStatus
  }) => Effect.Effect<
    {
      readonly entry: typeof WalkInQueueEntry.Type
      readonly notificationIntent: {
        readonly id: string
        readonly topic: string
        readonly sourceId: string
      }
    },
    WalkInError
  >
  readonly expireAcknowledgments: (
    now: string
  ) => Effect.Effect<readonly (typeof WalkInQueueEntry.Type)[], WalkInError>
}
export class WalkIns extends Context.Service<WalkIns, WalkInsShape>()(
  '@b2b-saas-starter/capabilities/WalkIns'
) {}
