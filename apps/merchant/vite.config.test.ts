import { expect, it } from 'vitest'

it('exposes the Merchant app on the local network', async () => {
  const { default: config } = await import('./vite.config.ts')
  const resolved = config({ command: 'serve', mode: 'development' })

  expect(resolved.server?.host).toBe(true)
  expect(resolved.server?.allowedHosts).toEqual([
    'hassans-macbook-pro.tail8c0b7c.ts.net'
  ])
  expect(resolved.preview?.host).toBe(true)
})
