// Local-only replacement for `cloudflare:workers`. TanStack's Vite adapter
// calls a Worker entry without its second `env` argument, so Booking reads
// this fallback while keeping the deployed Worker contract unchanged.
import type { D1Database } from '@cloudflare/workers-types'

const provisionLocalD1 = async (): Promise<D1Database | undefined> => {
  if (!import.meta.env.SSR) return undefined
  const { hasLocalD1State, provisionLocalD1 } =
    await import('@b2b-saas-starter/db/local-development')
  return hasLocalD1State() ? provisionLocalD1() : undefined
}

const localD1 = await provisionLocalD1()

export const env = {
  PUBLIC_SITE_ORIGIN: process.env.PUBLIC_SITE_ORIGIN ?? 'http://localhost:3071',
  CONFIRMATION_CURRENT_KEY_ID: process.env.CONFIRMATION_CURRENT_KEY_ID ?? 'local-v1',
  CONFIRMATION_SIGNING_KEYS:
    process.env.CONFIRMATION_SIGNING_KEYS ??
    '{"local-v1":"replace-before-production-confirmation-key"}',
  ...(localD1 ? { DB: localD1 } : {})
}
