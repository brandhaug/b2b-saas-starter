import { env as cloudflareEnv } from 'cloudflare:workers'
import { createAuth } from '@b2b-saas-starter/auth'
import { createDb } from '@b2b-saas-starter/db/client'

type WorkerEnv = {
  readonly DB: D1Database
  readonly BETTER_AUTH_SECRET: string
  readonly BETTER_AUTH_URL: string
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string
  readonly GITHUB_CLIENT_ID?: string
  readonly GITHUB_CLIENT_SECRET?: string
}

const env = cloudflareEnv as WorkerEnv

export function createServerContext() {
  let dbInstance: ReturnType<typeof createDb> | null = null
  let authInstance: ReturnType<typeof createAuth> | null = null

  function db() {
    if (dbInstance === null) dbInstance = createDb(env.DB)
    return dbInstance
  }

  function auth() {
    if (authInstance === null) {
      const trustedOrigins = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
        .map((origin: string) => origin.trim())
        .filter(Boolean)
      authInstance = createAuth({
        db: db(),
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
        ...(trustedOrigins ? { trustedOrigins } : {}),
        ...(env.GITHUB_CLIENT_ID ? { githubClientId: env.GITHUB_CLIENT_ID } : {}),
        ...(env.GITHUB_CLIENT_SECRET
          ? { githubClientSecret: env.GITHUB_CLIENT_SECRET }
          : {})
      })
    }
    return authInstance
  }

  return { db, auth }
}
