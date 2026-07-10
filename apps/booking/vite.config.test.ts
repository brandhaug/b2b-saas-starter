import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('aliases Booking Vite to the local Worker bindings during development', async () => {
  vi.stubEnv('BOOKING_VITE_DEV', '1')
  const { default: config } = await import('./vite.config.ts')
  const resolved = config({ command: 'serve', mode: 'development' })

  expect(resolved.resolve?.alias).toEqual({
    'cloudflare:workers': expect.stringMatching(/cloudflare-workers-shim-dev\.ts$/)
  })
})
