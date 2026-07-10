import type { D1Database } from '@cloudflare/workers-types'
import { env as baseEnv } from './cloudflare-workers-shim.ts'

const provisionLocalD1 = async (): Promise<D1Database | undefined> => {
  if (!import.meta.env.SSR) return undefined
  const localDevelopment = await import('@b2b-saas-starter/db/local-development')
  return localDevelopment.provisionLocalD1()
}

const localD1 = provisionLocalD1()

export const env = {
  ...baseEnv,
  // The module graph is also evaluated in the browser; only the server needs
  // the D1 binding and can await it safely before an auth request is handled.
  DB: await localD1
}
