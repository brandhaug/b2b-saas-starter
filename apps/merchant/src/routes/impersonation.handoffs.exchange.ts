import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { createMerchantImpersonationHandoffHandler } from '@/lib/impersonation-handoff.ts'
import { createMerchantServerContext } from '@/lib/server-context.ts'
import { makeOperationsAbuseProtection } from '@b2b-saas-starter/capabilities/operations'
import { clientKey } from '@b2b-saas-starter/rate-limit'

const unavailable = () =>
  Response.json(
    { error: 'impersonation_handoff_unavailable' },
    { status: 503, headers: { 'cache-control': 'no-store' } }
  )

const handle = (request: Request): Promise<Response> => {
  const context = createMerchantServerContext()
  const production = context.production()
  const operationsOrigin = env.OPERATIONS_APP_ORIGIN
  const securityContact = env.OPERATIONS_SECURITY_CONTACT
  if (
    !operationsOrigin ||
    !securityContact ||
    (production &&
      (!env.MERCHANT_AUTH_SECRET || !operationsOrigin.startsWith('https://')))
  ) {
    return Promise.resolve(unavailable())
  }
  return createMerchantImpersonationHandoffHandler({
    db: context.db(),
    auth: context.auth(),
    merchantSecret: context.merchantSecret(),
    merchantOrigin: context.merchantOrigin(),
    operationsOrigin,
    production,
    securityContact,
    consumeRateLimit: ({ handoffTicket, request }) =>
      makeOperationsAbuseProtection({
        db: context.db(),
        bindings: {
          ...(env.RATE_LIMITER_OPERATIONS_HANDOFF_EXCHANGE
            ? {
                handoffExchange: env.RATE_LIMITER_OPERATIONS_HANDOFF_EXCHANGE
              }
            : {})
        },
        fallbackLimits: {
          'handoff-exchange': Number(env.OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE ?? '10')
        },
        retryAfterSeconds: Number(env.OPERATIONS_RATE_LIMIT_WINDOW_SECONDS ?? '60')
      }).consume({
        category: 'handoff-exchange',
        subjectKey: handoffTicket,
        sourceKey: clientKey(request),
        operation: 'exchange'
      })
  })(request)
}

export const Route = createFileRoute('/impersonation/handoffs/exchange')({
  server: { handlers: { POST: ({ request }) => handle(request) } }
})
