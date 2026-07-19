import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { createMerchantImpersonationHandoffHandler } from '@/lib/impersonation-handoff.ts'
import { createMerchantServerContext } from '@/lib/server-context.ts'

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
    securityContact
  })(request)
}

export const Route = createFileRoute('/impersonation/handoffs/exchange')({
  server: { handlers: { POST: ({ request }) => handle(request) } }
})
