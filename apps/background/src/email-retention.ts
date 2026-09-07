import { EmailDelivery } from '@b2b-saas-starter/capabilities/email-delivery/email-delivery'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect } from 'effect'
import { type Env } from './queue-consumer.ts'

export function cleanEmailHistory(env: Env, scheduledTime: number) {
  return withTriggerScope(
    {
      service: 'background',
      event: 'email_retention',
      env,
      metadata: { scheduledTime }
    },
    Effect.gen(function* () {
      const delivery = yield* EmailDelivery
      const removed = yield* delivery.prune()
      yield* Effect.annotateLogsScoped({ removed })
    }).pipe(Effect.provide(selectCapabilitiesLayer(starterEnv(env))))
  )
}
