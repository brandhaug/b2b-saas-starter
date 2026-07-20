import { expect, it } from 'vitest'
import config from './vite.config.ts'

it('aliases browser runtime tests to isolated Worker bindings', () => {
  const resolved = config({ command: 'serve', mode: 'operations-browser-test' })

  expect(resolved.resolve?.alias).toEqual({
    'cloudflare:workers': expect.stringMatching(
      /cloudflare-workers-shim-browser-test\.ts$/
    )
  })
})
