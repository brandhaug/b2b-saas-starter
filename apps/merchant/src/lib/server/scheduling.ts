import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  liveMerchantContext,
  ScheduleRuleInput,
  selectCapabilitiesLayer
} from '@b2b-saas-starter/capabilities'
import {
  makeSchedulingRequestHandler,
  type SchedulingRunner
} from './scheduling-handler.ts'
import { requireMerchantRequestSession } from './merchant-session.ts'

const SaveRules = Schema.Struct({
  providerId: Schema.String,
  rules: Schema.Array(ScheduleRuleInput)
})
const SetPublished = Schema.Struct({ published: Schema.Boolean })

const run: SchedulingRunner = async (userId, effect) => {
  if (!env.DB) throw new Error('Scheduling requires the Merchant App D1 binding.')
  const context = liveMerchantContext(userId).pipe(Layer.provide(layerFromD1(env.DB)))
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(selectCapabilitiesLayer({ DB: env.DB }), context)
    )
  )
}

const requests = makeSchedulingRequestHandler({
  currentUserId: async () => (await requireMerchantRequestSession()).user.id,
  run,
  now: () => new Date().toISOString()
})

export const getSchedulingConfiguration = createServerFn({ method: 'GET' }).handler(
  () => requests.read()
)

export const saveScheduleRules = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SaveRules))
  .handler(({ data }) => requests.saveRules(data))

export const setPublicPagePublished = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SetPublished))
  .handler(({ data }) => requests.setPublished(data.published))
