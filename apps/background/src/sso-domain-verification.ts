import { resolveTxt } from 'node:dns/promises'
import { checkSsoDomains } from '@b2b-saas-starter/capabilities/governance/sso-domain-monitor'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { layerFromD1 } from '@b2b-saas-starter/db/service'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect } from 'effect'
import { type Env } from './queue-consumer.ts'

export const verifySsoDomainsDaily = Effect.fn('SsoDomains.daily')(function* (
  env: Env,
  scheduledTime: number
) {
  if (env.DB === undefined) {
    return
  }
  yield* withTriggerScope(
    {
      service: 'background',
      event: 'sso_domain_verification',
      env,
      metadata: { scheduledTime }
    },
    checkSsoDomains(resolveTxt).pipe(
      Effect.provide(selectCapabilitiesLayer(starterEnv(env))),
      Effect.provide(layerFromD1(env.DB))
    )
  )
})
