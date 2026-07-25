import { expect, it, vi } from 'vitest'

it('proxies local Booking pages, mutations, and assets before Web SSR', async () => {
  vi.stubEnv('BOOKING_DEV_ORIGIN', 'http://localhost:3073')
  const { default: config } = await import('./vite.config.ts')
  const resolved = config({ command: 'serve', mode: 'development' })

  expect(resolved.server?.host).toBe(true)
  expect(resolved.preview?.host).toBe(true)
  expect(resolved.server?.proxy).toEqual({
    '^/booking/[a-z0-9]+(?:-[a-z0-9]+)*(?:/|$)': expect.objectContaining({
      target: 'http://localhost:3073',
      changeOrigin: true,
      configure: expect.any(Function)
    }),
    '^/[a-z0-9]+(?:-[a-z0-9]+)*/booking(?:/|$)': expect.objectContaining({
      target: 'http://localhost:3073',
      changeOrigin: true,
      configure: expect.any(Function)
    }),
    '^/_booking/': { target: 'http://localhost:3073', changeOrigin: true },
    '^/virtual:stylex\\.css$': {
      target: 'http://localhost:3073',
      changeOrigin: true
    }
  })
  expect(resolved.server?.allowedHosts).toEqual(['.trycloudflare.com'])
  expect(resolved.server?.cors).toEqual({
    origin: [
      /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/,
      /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/
    ]
  })

  const routeProxy =
    resolved.server?.proxy?.['^/[a-z0-9]+(?:-[a-z0-9]+)*/booking(?:/|$)']
  if (typeof routeProxy === 'string' || !routeProxy?.configure)
    throw new Error('Booking route proxy is not configurable')
  let rewrite:
    | ((
        proxyRequest: { setHeader(name: string, value: string): void },
        request: { method?: string }
      ) => void)
    | undefined
  routeProxy.configure({
    on: (event: string, callback: typeof rewrite) => {
      if (event === 'proxyReq') rewrite = callback
    }
  } as never)
  const headers = new Map<string, string>()
  rewrite?.(
    { setHeader: (name, value) => headers.set(name, value) },
    { method: 'POST' }
  )
  expect(Object.fromEntries(headers)).toEqual({
    origin: 'http://localhost:3071',
    'sec-fetch-site': 'same-origin'
  })
})
