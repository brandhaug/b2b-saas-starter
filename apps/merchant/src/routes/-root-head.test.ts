import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { merchantHeadLinks } from './__root.tsx'
import { merchantThemeBootScript } from '@/lib/merchant-theme.ts'

const onestCss = readFileSync(new URL('../onest.css', import.meta.url), 'utf8')
const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const routerSource = readFileSync(new URL('../router.tsx', import.meta.url), 'utf8')

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
    expect(indexCss).toContain("@import './onest.css';")
    expect(routerSource).not.toContain("import './index.css'")
    expect(onestCss).not.toContain('font-display: swap')
    expect(onestCss.match(/font-display: optional/g)).toHaveLength(4)
  })

  it('resolves the saved or system theme before the app paints', () => {
    expect(merchantThemeBootScript).toContain("localStorage.getItem('merchant-theme')")
    expect(merchantThemeBootScript).toContain('prefers-color-scheme: dark')
    expect(merchantThemeBootScript).toContain("classList.toggle('dark', dark)")
    expect(merchantThemeBootScript).toContain('dataset.merchantTimeTheme')
  })

  it('allows the pre-paint theme script to change the document class before hydration', () => {
    const documentSource = readFileSync(
      new URL('../components/merchant-root-document.tsx', import.meta.url),
      'utf8'
    )

    expect(documentSource).toContain('suppressHydrationWarning')
    expect(documentSource.indexOf('<HeadContent />')).toBeLessThan(
      documentSource.indexOf('<script dangerouslySetInnerHTML')
    )
  })

  it('applies antialiasing to both desktop and mobile documents', () => {
    const documentSource = readFileSync(
      new URL('../components/merchant-root-document.tsx', import.meta.url),
      'utf8'
    )

    expect(documentSource).toMatch(
      /presentation === 'mobile'[\s\S]*\? 'merchant-mobile-document antialiased'\s*: 'merchant-desktop-document antialiased'/
    )
  })
})
