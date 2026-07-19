import type { OperationsRateLimitCategory } from './abuse-protection.ts'

export type OperationsEnvironment = {
  readonly OPERATIONS_AUTH_SECRET?: string
  readonly OPERATIONS_APP_ORIGIN?: string
  readonly OPERATIONS_AUTH_TRUSTED_ORIGINS?: string
  readonly MERCHANT_AUTH_SECRET?: string
  readonly OPERATIONS_LOCAL_SEED?: string
  readonly OPERATIONS_RATE_LIMIT_SESSION_READ?: string
  readonly OPERATIONS_RATE_LIMIT_AUTHENTICATION?: string
  readonly OPERATIONS_RATE_LIMIT_TOTP?: string
  readonly OPERATIONS_RATE_LIMIT_SEARCH?: string
  readonly OPERATIONS_RATE_LIMIT_MANAGEMENT?: string
  readonly OPERATIONS_RATE_LIMIT_IMPERSONATION_START?: string
  readonly OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE?: string
  readonly OPERATIONS_RATE_LIMIT_WINDOW_SECONDS?: string
  readonly ENVIRONMENT?: string
}

export type OperationsConfig = {
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: readonly string[]
  readonly production: boolean
  readonly localSeed: boolean
  readonly localDevelopment: boolean
  readonly rateLimits: {
    readonly fallbackLimits: Readonly<Record<OperationsRateLimitCategory, number>>
    readonly retryAfterSeconds: number
  }
}

const localRateLimitDefaults = {
  'operator-session-read': 1_000,
  'operator-authentication': 100,
  'operator-totp': 100,
  'merchant-discovery': 100,
  'operator-management': 100,
  'impersonation-start': 100,
  'handoff-exchange': 100
} as const satisfies Readonly<Record<OperationsRateLimitCategory, number>>

const configuredPositiveInteger = (
  name: string,
  value: string | undefined,
  localDefault: number,
  production: boolean
): number => {
  if (value === undefined) {
    if (production) throw new Error(`${name} is required in production`)
    return localDefault
  }
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return Number(value)
}

const origin = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`${name} is required`)
  const parsed = new URL(value)
  if (parsed.origin !== value || parsed.pathname !== '/') {
    throw new Error(`${name} must be an origin without a path`)
  }
  return parsed.origin
}

export const parseOperationsConfig = (env: OperationsEnvironment): OperationsConfig => {
  const production = env.ENVIRONMENT === 'production'
  const localDevelopment =
    env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test'
  const secret = env.OPERATIONS_AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('OPERATIONS_AUTH_SECRET must contain at least 32 characters')
  }
  if (env.MERCHANT_AUTH_SECRET && env.MERCHANT_AUTH_SECRET === secret) {
    throw new Error('Operations and Merchant auth secrets must be distinct')
  }
  const baseURL = origin('OPERATIONS_APP_ORIGIN', env.OPERATIONS_APP_ORIGIN)
  if (production && !baseURL.startsWith('https://')) {
    throw new Error('production Operations origin must use https')
  }
  const trustedOrigins = (env.OPERATIONS_AUTH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => origin('OPERATIONS_AUTH_TRUSTED_ORIGINS', value))
  if (!trustedOrigins.includes(baseURL)) {
    throw new Error('Operations base URL must be included in trusted origins')
  }
  const localSeed = env.OPERATIONS_LOCAL_SEED === 'enabled'
  if (!localDevelopment && localSeed) {
    throw new Error('Operations local seed is forbidden outside local development')
  }
  const rateLimit = (
    name: string,
    value: string | undefined,
    category: OperationsRateLimitCategory
  ) =>
    configuredPositiveInteger(name, value, localRateLimitDefaults[category], production)
  return {
    secret,
    baseURL,
    trustedOrigins,
    production,
    localSeed,
    localDevelopment,
    rateLimits: {
      fallbackLimits: {
        'operator-session-read': rateLimit(
          'OPERATIONS_RATE_LIMIT_SESSION_READ',
          env.OPERATIONS_RATE_LIMIT_SESSION_READ,
          'operator-session-read'
        ),
        'operator-authentication': rateLimit(
          'OPERATIONS_RATE_LIMIT_AUTHENTICATION',
          env.OPERATIONS_RATE_LIMIT_AUTHENTICATION,
          'operator-authentication'
        ),
        'operator-totp': rateLimit(
          'OPERATIONS_RATE_LIMIT_TOTP',
          env.OPERATIONS_RATE_LIMIT_TOTP,
          'operator-totp'
        ),
        'merchant-discovery': rateLimit(
          'OPERATIONS_RATE_LIMIT_SEARCH',
          env.OPERATIONS_RATE_LIMIT_SEARCH,
          'merchant-discovery'
        ),
        'operator-management': rateLimit(
          'OPERATIONS_RATE_LIMIT_MANAGEMENT',
          env.OPERATIONS_RATE_LIMIT_MANAGEMENT,
          'operator-management'
        ),
        'impersonation-start': rateLimit(
          'OPERATIONS_RATE_LIMIT_IMPERSONATION_START',
          env.OPERATIONS_RATE_LIMIT_IMPERSONATION_START,
          'impersonation-start'
        ),
        'handoff-exchange': rateLimit(
          'OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE',
          env.OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE,
          'handoff-exchange'
        )
      },
      retryAfterSeconds: configuredPositiveInteger(
        'OPERATIONS_RATE_LIMIT_WINDOW_SECONDS',
        env.OPERATIONS_RATE_LIMIT_WINDOW_SECONDS,
        60,
        production
      )
    }
  }
}
