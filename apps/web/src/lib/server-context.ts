import { env } from 'cloudflare:workers'
import { createAuth } from '@b2b-saas-starter/auth'
import { createDb } from '@b2b-saas-starter/db/client'

// Under the local workers shim there is no D1 binding. Auth stays importable
// (getSession without a cookie never queries), and any query that does run
// fails with a descriptive error instead of a deep drizzle TypeError.
const missingD1 = new Proxy(
  {},
  {
    get() {
      throw new Error('D1 binding is unavailable in the local workers shim')
    }
  }
) as D1Database

export function createServerContext() {
  let dbInstance: ReturnType<typeof createDb> | null = null
  let authInstance: ReturnType<typeof createAuth> | null = null

  function db() {
    if (dbInstance === null) dbInstance = createDb(env.DB ?? missingD1)
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
