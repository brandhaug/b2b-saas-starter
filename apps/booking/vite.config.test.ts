import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('aliases Booking Vite to the local Worker bindings during development', async () => {
  vi.stubEnv('BOOKING_VITE_DEV', '1')
  const { default: config } = await import('./vite.config.ts')
  const resolved = config({ command: 'serve', mode: 'development' })

  expect(resolved.server?.host).toBe(true)
  expect(resolved.server?.allowedHosts).toEqual([
    'hassans-macbook-pro.tail8c0b7c.ts.net'
  ])
  expect(resolved.preview?.host).toBe(true)
  expect(resolved.resolve?.alias).toEqual({
    'cloudflare:workers': expect.stringMatching(/cloudflare-workers-shim-dev\.ts$/)
  })
})

it('keeps StyleX media queries out of the broken reordering pass', async () => {
  const { bookingStylexOptions } = await import('./vite.config.ts')

  expect(bookingStylexOptions.enableMediaQueryOrder).toBe(false)
})
