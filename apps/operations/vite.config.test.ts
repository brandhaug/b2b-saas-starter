import { expect, it } from 'vitest'
import config from './vite.config.ts'

it('exposes the Operations app through the Tailscale MagicDNS host', () => {
  const resolved = config({ command: 'serve', mode: 'development' })

  expect(resolved.server?.host).toBe(true)
  expect(resolved.server?.allowedHosts).toEqual([
    'hassans-macbook-pro.tail8c0b7c.ts.net'
  ])
})

it('aliases browser runtime tests to isolated Worker bindings', () => {
  const resolved = config({ command: 'serve', mode: 'operations-browser-test' })

  expect(resolved.resolve?.alias).toEqual({
    'cloudflare:workers': expect.stringMatching(
      /cloudflare-workers-shim-browser-test\.ts$/
    )
  })
})
