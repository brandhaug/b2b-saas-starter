declare module 'cloudflare:workers' {
  type RateLimitBindingLike = {
    readonly limit: (input: { readonly key: string }) => Promise<{
      readonly success: boolean
    }>
  }
  export interface Env {
    readonly DB: D1Database
    readonly BETTER_AUTH_SECRET: string
    readonly BETTER_AUTH_URL: string
    readonly BETTER_AUTH_TRUSTED_ORIGINS?: string
    readonly GITHUB_CLIENT_ID?: string
    readonly GITHUB_CLIENT_SECRET?: string
    readonly RATE_LIMITER_AUTH_READ?: RateLimitBindingLike
    readonly RATE_LIMITER_AUTH_WRITE?: RateLimitBindingLike
  }
  export const env: Env
}

interface Env {
  readonly DB: D1Database
  readonly BETTER_AUTH_SECRET: string
  readonly BETTER_AUTH_URL: string
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string
  readonly GITHUB_CLIENT_ID?: string
  readonly GITHUB_CLIENT_SECRET?: string
  readonly RATE_LIMITER_AUTH_READ?: {
    readonly limit: (input: { readonly key: string }) => Promise<{
      readonly success: boolean
    }>
  }
  readonly RATE_LIMITER_AUTH_WRITE?: {
    readonly limit: (input: { readonly key: string }) => Promise<{
      readonly success: boolean
    }>
  }
}
