import { describe, expect, it } from 'vitest'
import { createContentStore } from './content-store.ts'

describe('content-addressed fixture and local-asset store', () => {
  it('resolves immutable bytes by their integrity identity', async () => {
    const store = createContentStore()
    const identity = await store.put(new TextEncoder().encode('booking-asset'))

    expect(identity).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(new TextDecoder().decode(store.get(identity))).toBe('booking-asset')
    expect(() => store.get('sha256:missing')).toThrow(/unknown content identity/i)
  })

  it('serves only locally stored content with immutable caching', async () => {
    const store = createContentStore()
    const identity = await store.put(new TextEncoder().encode('<svg/>'))
    const response = store.response(identity, 'image/svg+xml')

    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    )
    await expect(response.text()).resolves.toBe('<svg/>')
  })
})
