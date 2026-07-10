import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
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
    rateLimiter: createMerchantRateLimiter(env)
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
