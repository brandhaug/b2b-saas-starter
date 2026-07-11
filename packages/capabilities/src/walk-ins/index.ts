import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { ShopId, WalkInEntryId } from '../ids.ts'

export const WalkInEntry = Schema.Struct({
  id: WalkInEntryId,
  shopId: ShopId,
  status: Schema.Literals([
    'waiting',
    'called',
    'serving',
    'served',
    'removed',
    'expired'
  ]),
  position: Schema.Number
})
export class WalkInEntryNotFound extends Schema.TaggedErrorClass<WalkInEntryNotFound>()(
  'WalkInEntryNotFound',
  { entryId: WalkInEntryId }
) {}
export type WalkInsShape = {
  readonly findById: (
    entryId: string
  ) => Effect.Effect<
    typeof WalkInEntry.Type,
    WalkInEntryNotFound | CapabilityUnavailable
  >
}
export class WalkIns extends Context.Service<WalkIns, WalkInsShape>()(
  '@b2b-saas-starter/capabilities/WalkIns'
) {}
