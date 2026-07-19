export type OperationsEnvironment = {
  readonly OPERATIONS_AUTH_SECRET?: string
  readonly OPERATIONS_APP_ORIGIN?: string
  readonly OPERATIONS_AUTH_TRUSTED_ORIGINS?: string
  readonly MERCHANT_AUTH_SECRET?: string
  readonly OPERATIONS_LOCAL_SEED?: string
  readonly ENVIRONMENT?: string
}

export type OperationsConfig = {
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: readonly string[]
  readonly production: boolean
  readonly localSeed: boolean
  readonly localDevelopment: boolean
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
  return {
    secret,
    baseURL,
    trustedOrigins,
    production,
    localSeed,
    localDevelopment
  }
}
