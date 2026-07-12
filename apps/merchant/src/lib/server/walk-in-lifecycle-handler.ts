import { Effect } from 'effect'
import {
  MerchantContext,
  ShopTopology
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  WalkIns,
  type WalkInQueueEntry,
  type WalkInStatus
} from '@b2b-saas-starter/capabilities/walk-ins'

type Services = MerchantContext | ShopTopology | WalkIns
export type WalkInLifecycleRunner = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, Services>
) => Promise<A>

const ownedShop = (shopId: string) =>
  Effect.gen(function* () {
    const merchant = yield* MerchantContext
    const topology = yield* ShopTopology
    return yield* topology.findOwnedById({ merchantId: merchant.id, shopId })
  })

export const makeWalkInLifecycleRequestHandler = (dependencies: {
  readonly currentUserId: () => Promise<string>
  readonly run: WalkInLifecycleRunner
}) => ({
  shops: async () => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        return yield* (yield* ShopTopology).listOwned(merchant.id)
      })
    )
  },
  queue: async (shopId: string): Promise<readonly WalkInQueueEntry[]> => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.gen(function* () {
        yield* ownedShop(shopId)
        return yield* (yield* WalkIns).queue(shopId)
      })
    )
  },
  transition: async (input: {
    readonly shopId: string
    readonly entryId: string
    readonly to: WalkInStatus
  }): Promise<WalkInQueueEntry> => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.gen(function* () {
        yield* ownedShop(input.shopId)
        return (yield* (yield* WalkIns).transition(input)).entry
      })
    )
  }
})
