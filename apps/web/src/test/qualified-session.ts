import { vi } from 'vite-plus/test'
import type * as AuthenticationModule from '@b2b-saas-starter/capabilities/governance/strong-authentication'

// These handler suites substitute authentication and exercise application/RBAC
// behavior. Opt in explicitly; authentication suites use real session evidence.
vi.mock(
  '@b2b-saas-starter/capabilities/governance/strong-authentication',
  async (importOriginal) => {
    const actual = await importOriginal<typeof AuthenticationModule>()
    const { Effect, Layer } = await import('effect')
    const qualified = Layer.succeed(actual.StrongAuthentication)({
      status: () =>
        Effect.succeed({
          qualified: true,
          recent: true,
          recovering: false,
          hasFactors: true,
          passwordVerified: true
        }),
      require: () => Effect.void,
      requireRecent: () => Effect.void
    })
    return { ...actual, SeedStrongAuthentication: qualified }
  }
)
