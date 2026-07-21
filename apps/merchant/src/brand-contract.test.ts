import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const stylesUrl = new URL('./index.css', import.meta.url)

describe('merchant BeeSolo brand contract', () => {
  it('uses the canonical honey primary with black foreground in both themes', async () => {
    const css = await readFile(stylesUrl, 'utf8')

    expect(css).toContain('--primary: oklch(0.9 0.1739 96.8561)')
    expect(css.match(/--primary-foreground: oklch\(0 0 0\)/g)).toHaveLength(2)
  })

  it('keeps presentation classes independent from color tokens', async () => {
    const css = await readFile(stylesUrl, 'utf8')
    const mobilePresentation = css.match(/\.merchant-mobile\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(mobilePresentation).not.toContain('--primary:')
    expect(mobilePresentation).not.toContain('--background:')
    expect(mobilePresentation).not.toContain('color-scheme:')
  })

  it('uses the BeeSolo sky asset without CSS gradients', async () => {
    const css = await readFile(stylesUrl, 'utf8')

    expect(css).toContain("background-image: url('/brand/hero-sky.svg')")
    expect(css).not.toContain('gradient')
  })

  it('exposes sidebar and status roles to Tailwind', async () => {
    const css = await readFile(stylesUrl, 'utf8')

    expect(css).toContain('--color-sidebar: var(--sidebar)')
    expect(css).toContain('--color-success: var(--success)')
    expect(css).toContain('--color-warning: var(--warning)')
    expect(css).toContain('--color-info: var(--info)')
  })
})
