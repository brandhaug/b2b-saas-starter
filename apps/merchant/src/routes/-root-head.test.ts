import { describe, expect, it } from 'vitest'
import { merchantHeadLinks } from './__root.tsx'

describe('merchant head links', () => {
  it('preloads the primary Onest font used by the initial render', () => {
    expect(merchantHeadLinks).toContainEqual({
      rel: 'preload',
      href: expect.stringContaining('onest-latin-wght-normal'),
      as: 'font',
      type: 'font/woff2',
      crossOrigin: 'anonymous'
    })
  })
})
