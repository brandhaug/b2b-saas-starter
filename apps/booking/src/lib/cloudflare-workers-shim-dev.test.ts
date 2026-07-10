import type { D1Database } from '@cloudflare/workers-types'
import { expect, it, vi } from 'vitest'

const database = {} as D1Database

vi.mock('@b2b-saas-starter/db/local-development', () => ({
  hasLocalD1State: () => true,
  provisionLocalD1: async () => database
}))

it('provides the local D1 and Public Site origin to Booking Vite', async () => {
  const { env } = await import('./cloudflare-workers-shim-dev.ts')

  expect(env).toEqual({
    DB: database,
    PUBLIC_SITE_ORIGIN: 'http://localhost:3071'
  })
})
