import { expect, it } from 'vitest'

it('exposes the Merchant app on the local network', async () => {
  const { default: config } = await import('./vite.config.ts')
  const resolved = config({ command: 'serve', mode: 'development' })

  expect(resolved.server?.host).toBe(true)
  expect(resolved.preview?.host).toBe(true)
})
