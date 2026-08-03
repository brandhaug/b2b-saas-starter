import type { D1Database } from '@cloudflare/workers-types'
import { expect, it, vi } from 'vitest'

const database = {} as D1Database

vi.mock('@b2b-saas-starter/db/local-development', () => ({
  hasLocalD1State: () => true,
  provisionLocalD1: async () => database
}))

it('provides the required local Booking Worker environment to Vite', async () => {
  const { env } = await import('./cloudflare-workers-shim-dev.ts')

  expect(env).toEqual({
    DB: database,
    PUBLIC_SITE_ORIGIN: 'http://localhost:3071',
    CONFIRMATION_CURRENT_KEY_ID: 'local-v1',
    CUSTOMER_DIRECTORY_FINGERPRINT_KEY:
      'local-customer-directory-fingerprint-key-change-me',
    CONFIRMATION_SIGNING_KEYS:
      '{"local-v1":"replace-before-production-confirmation-key"}'
  })
})
