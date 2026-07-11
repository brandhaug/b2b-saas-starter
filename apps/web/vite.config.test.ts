import { expect, it, vi } from 'vitest'

it('proxies local Booking pages, mutations, and assets before Web SSR', async () => {
  vi.stubEnv('BOOKING_DEV_ORIGIN', 'http://localhost:3073')
  const { default: config } = await import('./vite.config.ts')
  const resolved = config({ command: 'serve', mode: 'development' })

  expect(resolved.server?.proxy).toEqual({
    '^/[a-z0-9]+(?:-[a-z0-9]+)*/booking(?:/|$)': {
      target: 'http://localhost:3073'
    },
    '^/_booking/': { target: 'http://localhost:3073' },
    '^/virtual:stylex\\.css$': { target: 'http://localhost:3073' }
  })
})
