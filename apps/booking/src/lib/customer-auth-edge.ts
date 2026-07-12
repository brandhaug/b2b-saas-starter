import { createCustomerAuth } from '@b2b-saas-starter/auth'
import { createDb } from '@b2b-saas-starter/db'
import { customerIdentityProviderStates } from '@b2b-saas-starter/capabilities/customer-identity'

export type CustomerAuthEdgeConfig = {
  readonly db: D1Database
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigin: string
  readonly production: boolean
  readonly googleEnabled: boolean
  readonly googleClientId?: string
  readonly googleClientSecret?: string
  readonly appleEnabled: boolean
  readonly appleClientId?: string
  readonly appleClientSecret?: string
}

export const customerAuthProviderState = (config: CustomerAuthEdgeConfig) => {
  const states = customerIdentityProviderStates(config)
  if (config.secret.trim()) return states
  return {
    google:
      states.google === 'configured' ? ('needs_configuration' as const) : states.google,
    apple:
      states.apple === 'configured' ? ('needs_configuration' as const) : states.apple
  }
}

export const customerAuthProviderOutcome = (
  requestUrl: URL,
  authenticated: boolean
):
  | { readonly state: 'success'; readonly provider: 'google' | 'apple' }
  | {
      readonly state: 'error'
      readonly provider: 'google' | 'apple'
    }
  | null => {
  const provider = requestUrl.searchParams.get('provider')
  if (provider !== 'google' && provider !== 'apple') return null
  if (authenticated) return { state: 'success', provider }
  return requestUrl.searchParams.has('error') ? { state: 'error', provider } : null
}

export const makeCustomerAuthEdge = (config: CustomerAuthEdgeConfig) => {
  const db = createDb(config.db)
  const providers = customerAuthProviderState(config)
  const auth = createCustomerAuth({
    db,
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: [config.trustedOrigin],
    production: config.production,
    ...(providers.google === 'configured'
      ? {
          google: {
            clientId: config.googleClientId!,
            clientSecret: config.googleClientSecret!
          }
        }
      : {}),
    ...(providers.apple === 'configured'
      ? {
          apple: {
            clientId: config.appleClientId!,
            clientSecret: config.appleClientSecret!
          }
        }
      : {})
  })
  return {
    providers,
    session: (headers: Headers) => auth.api.getSession({ headers }),
    principal: async (headers: Headers) => {
      const current = await auth.api.getSession({ headers })
      if (!current?.user.emailVerified) return null
      const provider = await config.db
        .prepare(
          'SELECT providerId, accountId FROM account WHERE userId = ? AND providerId IN (?, ?) ORDER BY createdAt DESC LIMIT 1'
        )
        .bind(current.user.id, 'google', 'apple')
        .first<{ providerId: 'google' | 'apple'; accountId: string }>()
      if (!provider) return null
      return {
        provider: provider.providerId,
        providerSubject: provider.accountId,
        email: current.user.email,
        emailVerified: true as const,
        displayName: current.user.name || null
      }
    },
    handle: (request: Request): Promise<Response | null> => {
      const pathname = new URL(request.url).pathname
      if (!pathname.startsWith('/api/customer-auth/')) return Promise.resolve(null)
      return auth.handler(request)
    }
  }
}
