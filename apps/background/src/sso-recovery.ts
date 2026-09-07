import { SsoPolicy } from '@b2b-saas-starter/capabilities/governance/sso-policy'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { layerFromD1 } from '@b2b-saas-starter/db/service'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect } from 'effect'
import { type Env } from './queue-consumer.ts'

export const maintainSsoRecovery = Effect.fn('SsoRecovery.maintain')(function* (
  env: Env,
  scheduledTime: number
) {
  if (env.DB === undefined) {
    return
  }
  yield* withTriggerScope(
    {
      service: 'background',
      event: 'sso_recovery_maintenance',
      env,
      metadata: { scheduledTime }
    },
    Effect.gen(function* () {
      const policy = yield* SsoPolicy
      yield* policy.expireRecoveryExceptions
      yield* policy.flushRecoveryNotifications
    }).pipe(
      Effect.provide(selectCapabilitiesLayer(starterEnv(env))),
      Effect.provide(layerFromD1(env.DB))
    )
  )
})
