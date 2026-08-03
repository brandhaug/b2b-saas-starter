import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Effect } from 'effect'
import { PlatformApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform'
import { MerchantMembership } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { createMerchantServerContext } from '../server-context.ts'
import { runMerchantRequest } from './merchant-session.ts'

export const bootstrapPlatformApiToken = createServerFn({ method: 'POST' })
  .validator((input: { readonly password: string; readonly name: string }) => input)
  .handler(({ data }) =>
    runMerchantRequest('credential.create', async (session) => {
      if (!env.DB) throw new Error('Platform API Tokens require D1.')
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
            const registry = yield* PlatformApiTokenRegistry
            return yield* registry.bootstrap({
              merchantId: merchant.id,
              name: data.name.trim(),
              scopes: [
                'merchant:read',
                'services:read',
                'providers:read',
                'appointments:read',
                'api_tokens:manage',
                'webhooks:manage'
              ],
              expiresAt: null,
              proof: {
                userId: session.user.id,
                method: 'password',
                verifiedAt: new Date().toISOString()
              }
            })
          }),
          selectCapabilitiesLayer({ DB: env.DB })
        )
      )
    })
  )
