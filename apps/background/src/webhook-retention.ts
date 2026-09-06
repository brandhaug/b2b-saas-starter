import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect } from 'effect'

import { type Env } from './queue-consumer.ts'

export const cleanWebhookHistory = Effect.fn('Webhooks.cleanHistory')(function* (
  env: Env,
  scheduledTime: number
) {
  return yield* withTriggerScope(
    {
      service: 'background',
      event: 'webhook_retention',
      env,
      metadata: { scheduledTime }
    },
    Effect.gen(function* () {
      const webhooks = yield* WebhookEndpoints
      const removed = yield* webhooks.cleanupDeliveryHistory()
      yield* Effect.annotateLogsScoped({ removed })
    }).pipe(Effect.provide(selectCapabilitiesLayer(starterEnv(env))))
  )
})
