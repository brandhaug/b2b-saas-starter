import { describe, expect, it, vi } from 'vitest'

const { database, getPlatformProxy } = vi.hoisted(() => ({
  database: {},
  getPlatformProxy: vi.fn(async () => ({ env: { DB: {} } }))
}))

vi.mock('wrangler', () => ({ getPlatformProxy }))

import { provisionLocalD1 } from './local-development.ts'

describe('local D1 development paths', () => {
  it('provisions the Wrangler v3 state populated by local migrations', async () => {
    getPlatformProxy.mockResolvedValueOnce({ env: { DB: database } })

    await expect(provisionLocalD1()).resolves.toBe(database)
    expect(getPlatformProxy).toHaveBeenCalledWith({
      configPath: expect.stringMatching(/packages\/db\/wrangler\.jsonc$/),
      persist: {
        path: expect.stringMatching(/packages\/db\/\.wrangler\/state\/v3$/)
      }
    })
  })
})
