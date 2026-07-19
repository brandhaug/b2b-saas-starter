import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { Effect } from 'effect'
import {
  OperationsImpersonationAuthority,
  makeOperationsImpersonationAuthorityLayer
} from '@b2b-saas-starter/capabilities/operations'
import { createMerchantAuthHandler } from '@/lib/merchant-auth-handler.ts'
import { createMerchantRateLimiter } from '@/lib/rate-limit.ts'
import { createMerchantServerContext } from '@/lib/server-context.ts'

const handleAuth = (request: Request): Promise<Response> => {
  const context = createMerchantServerContext()
  return createMerchantAuthHandler({
    auth: {
      handler: context.auth().handler,
      getSession: (headers) => context.auth().api.getSession({ headers })
    },
    emailDelivery: context.emailDelivery(),
    environment: context.production() ? 'production' : 'development',
    rateLimiter: createMerchantRateLimiter(env),
    authorizeImpersonated: (input) =>
      Effect.runPromise(
        Effect.flatMap(OperationsImpersonationAuthority, (authority) =>
          authority.authorize(input)
        ).pipe(
          Effect.provide(
            makeOperationsImpersonationAuthorityLayer(context.db(), {
              securityContact: env.OPERATIONS_SECURITY_CONTACT ?? ''
            })
          )
        )
      )
  })(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request)
    }
  }
})
