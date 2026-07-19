import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { liveMerchantContext } from '@b2b-saas-starter/capabilities/merchant-catalog'
import type { Shop } from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  WalkInStatus,
  type WalkInQueueEntry
} from '@b2b-saas-starter/capabilities/walk-ins'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import {
  makeWalkInLifecycleRequestHandler,
  type WalkInLifecycleRunner
} from './walk-in-lifecycle-handler.ts'
import { runMerchantRequest } from './merchant-session.ts'

const QueueInput = Schema.Struct({ shopId: Schema.String })
const TransitionInput = Schema.Struct({
  shopId: Schema.String,
  entryId: Schema.String,
  to: WalkInStatus
})
const run: WalkInLifecycleRunner = async (userId, effect) => {
  if (!env.DB)
    throw new Error('Walk-in lifecycle requires the Merchant App D1 binding.')
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(
        selectCapabilitiesLayer({ DB: env.DB }),
        liveMerchantContext(userId).pipe(Layer.provide(layerFromD1(env.DB)))
      )
    )
  )
}
const requestsFor = (userId: string) =>
  makeWalkInLifecycleRequestHandler({
    currentUserId: async () => userId,
    run
  })

export const getWalkInShops = createServerFn({ method: 'GET' }).handler(
  async (): Promise<readonly Shop[]> =>
    runMerchantRequest('walk-in.read', (session) =>
      requestsFor(session.user.id).shops()
    )
)

export const getWalkInQueue = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(QueueInput))
  .handler(
    async ({ data }): Promise<readonly WalkInQueueEntry[]> =>
      runMerchantRequest('walk-in.read', (session) =>
        requestsFor(session.user.id).queue(data.shopId)
      )
  )

export const transitionWalkInEntry = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(TransitionInput))
  .handler(
    async ({ data }): Promise<WalkInQueueEntry> =>
      runMerchantRequest('walk-in.update', (session) =>
        requestsFor(session.user.id).transition(data)
      )
  )
