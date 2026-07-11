import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Effect } from 'effect'
import { PlatformWebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform'
import { MerchantMembership } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { createMerchantServerContext } from '../server-context.ts'
import { requireMerchantRequestSession } from './merchant-session.ts'

export const rotatePlatformWebhookSecret = createServerFn({ method: 'POST' })
  .validator(
    (input: { readonly endpointId: string; readonly password: string }) => input
  )
  .handler(async ({ data }) => {
    if (!env.DB) throw new Error('Platform Webhooks require D1.')
    const session = await requireMerchantRequestSession()
    await createMerchantServerContext()
      .auth()
      .api.verifyPassword({
        body: { password: data.password },
        headers: getRequest().headers
      })
    return Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const membership = yield* MerchantMembership
          const merchant = yield* membership.resolveForUser(session.user.id)
          const webhooks = yield* PlatformWebhookEndpoints
          return yield* webhooks.rotateSecretFromMerchantSettings({
            merchantId: merchant.id,
            endpointId: data.endpointId,
            proof: {
              userId: session.user.id,
              method: 'password',
              verifiedAt: new Date().toISOString()
            }
          })
        }),
        selectCapabilitiesLayer({
          DB: env.DB,
          PLATFORM_API_CURSOR_SECRET: env.PLATFORM_API_CURSOR_SECRET,
          REQUIRE_PLATFORM_API_CURSOR_SECRET: env.ENVIRONMENT === 'production'
        })
      )
    )
  })
