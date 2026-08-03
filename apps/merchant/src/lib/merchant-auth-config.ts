import type { BetterAuthOptions } from 'better-auth'

export type MerchantAuthEnvironment = {
  readonly MERCHANT_AUTH_SECRET?: string
  readonly MERCHANT_AUTH_URL?: string
  readonly MERCHANT_AUTH_TRUSTED_ORIGINS?: string
}

export type MerchantAuthConfig = {
  readonly secret: string
  readonly baseURL: NonNullable<BetterAuthOptions['baseURL']>
  readonly canonicalOrigin: string
  readonly trustedOrigins: string[]
}

const localConfig = {
  secret: 'local-merchant-auth-secret-change-me-minimum-32-chars',
  canonicalOrigin: 'http://localhost:3072'
} as const

const localAllowedHosts = ['localhost:*', '192.168.*.*:*']

const required = (
  value: string | undefined,
  name: keyof MerchantAuthEnvironment
): string => {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required in production`)
  return normalized
}

const origin = (value: string, name: string): string => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid origin`)
  }
  if (
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(`${name} must contain only an origin`)
  }
  return parsed.origin
}

const isLocalHostname = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
  hostname === '[::1]' ||
  hostname === '[0:0:0:0:0:0:0:1]'

const requireProductionOrigin = (value: string, name: string): string => {
  const normalized = origin(value, name)
  const parsed = new URL(normalized)
  if (parsed.protocol !== 'https:' || isLocalHostname(parsed.hostname)) {
    throw new Error(`${name} must be a non-local HTTPS origin in production`)
  }
  return normalized
}

export const resolveMerchantAuthConfig = (
  environment: MerchantAuthEnvironment,
  production: boolean
): MerchantAuthConfig => {
  if (!production) {
    const canonicalOrigin = origin(
      environment.MERCHANT_AUTH_URL ?? localConfig.canonicalOrigin,
      'MERCHANT_AUTH_URL'
    )
    const trustedOrigins = (environment.MERCHANT_AUTH_TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .map((candidate) => origin(candidate, 'MERCHANT_AUTH_TRUSTED_ORIGINS'))
    const configuredHosts = [canonicalOrigin, ...trustedOrigins].map(
      (candidate) => new URL(candidate).host
    )
    return {
      secret: environment.MERCHANT_AUTH_SECRET ?? localConfig.secret,
      baseURL: {
        allowedHosts: [...new Set([...localAllowedHosts, ...configuredHosts])],
        protocol: 'auto',
        fallback: canonicalOrigin
      },
      canonicalOrigin,
      trustedOrigins
    }
  }

  const secret = required(environment.MERCHANT_AUTH_SECRET, 'MERCHANT_AUTH_SECRET')
  if (secret.length < 32) {
    throw new Error('MERCHANT_AUTH_SECRET must contain at least 32 characters')
  }
  const baseURL = requireProductionOrigin(
    required(environment.MERCHANT_AUTH_URL, 'MERCHANT_AUTH_URL'),
    'MERCHANT_AUTH_URL'
  )
  const trustedOrigins = required(
    environment.MERCHANT_AUTH_TRUSTED_ORIGINS,
    'MERCHANT_AUTH_TRUSTED_ORIGINS'
  )
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) =>
      requireProductionOrigin(candidate, 'MERCHANT_AUTH_TRUSTED_ORIGINS')
    )
  if (!trustedOrigins.includes(baseURL)) {
    throw new Error('MERCHANT_AUTH_TRUSTED_ORIGINS must include the Merchant base URL')
  }
  return { secret, baseURL, canonicalOrigin: baseURL, trustedOrigins }
}
