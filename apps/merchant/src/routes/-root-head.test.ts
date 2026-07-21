import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { merchantHeadLinks } from './__root.tsx'

const onestCss = readFileSync(new URL('../onest.css', import.meta.url), 'utf8')

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

  it('does not replace fallback text with a late font after first paint', () => {
    expect(onestCss).not.toContain('font-display: swap')
    expect(onestCss.match(/font-display: optional/g)).toHaveLength(4)
  })
})
