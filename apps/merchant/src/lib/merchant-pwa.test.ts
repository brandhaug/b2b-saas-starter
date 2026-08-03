import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const publicAsset = (path: string) => new URL(`../../public/${path}`, import.meta.url)

describe('authenticated Merchant App PWA assets', () => {
  it('publishes one stable root-scoped application identity', async () => {
    const manifest = JSON.parse(
      await readFile(publicAsset('manifest.webmanifest'), 'utf8')
    ) as Record<string, unknown>

    expect(manifest).toMatchObject({
      id: '/',
      name: 'BeeSolo Merchant',
      short_name: 'BeeSolo',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      icons: [
        {
          src: '/icons/merchant-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: '/icons/merchant-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: '/icons/merchant-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    })
  })

  it('keeps the initial worker lifecycle-only and network-authoritative', async () => {
    const worker = await readFile(publicAsset('merchant-sw.js'), 'utf8')

    expect(worker).toContain("addEventListener('install'")
    expect(worker).toContain("addEventListener('activate'")
    expect(worker).not.toMatch(/addEventListener\(['"]fetch['"]/)
    expect(worker).not.toContain('caches.')
  })

  it('ships exact install and maskable icon dimensions', async () => {
    const pngSize = async (path: string) => {
      const png = await readFile(publicAsset(path))
      return [png.readUInt32BE(16), png.readUInt32BE(20)]
    }

    await expect(pngSize('icons/merchant-192.png')).resolves.toEqual([192, 192])
    await expect(pngSize('icons/merchant-512.png')).resolves.toEqual([512, 512])
    await expect(pngSize('icons/merchant-maskable-512.png')).resolves.toEqual([
      512, 512
    ])
    await expect(pngSize('icons/apple-touch-icon-180.png')).resolves.toEqual([180, 180])
  })

  it('forces browsers to revalidate installation metadata and worker updates', async () => {
    const headers = await readFile(publicAsset('_headers'), 'utf8')

    expect(headers).toContain('/merchant-sw.js')
    expect(headers).toContain('/manifest.webmanifest')
    expect(
      headers.match(/Cache-Control: no-cache, max-age=0, must-revalidate/g)
    ).toHaveLength(2)
  })

  it('defines four-sided safe-area composition for edge-to-edge windows', async () => {
    const styles = await readFile(new URL('../index.css', import.meta.url), 'utf8')
    const homeActions = await readFile(
      new URL(
        '../components/merchant-shell/mobile/mobile-home-actions.tsx',
        import.meta.url
      ),
      'utf8'
    )

    expect(styles).toContain('--merchant-safe-area-top: env(safe-area-inset-top, 0px)')
    expect(styles).toContain(
      '--merchant-safe-area-right: env(safe-area-inset-right, 0px)'
    )
    expect(styles).toContain(
      '--merchant-safe-area-bottom: env(safe-area-inset-bottom, 0px)'
    )
    expect(styles).toContain(
      '--merchant-safe-area-left: env(safe-area-inset-left, 0px)'
    )
    expect(styles).toContain('.merchant-safe-area-inline')
    expect(styles).toContain('.merchant-safe-area-page')
    expect(homeActions).toContain('merchant-safe-area-inline')
  })

  it('anchors the translucent installed document to the full static viewport', async () => {
    const styles = await readFile(new URL('../index.css', import.meta.url), 'utf8')

    expect(styles).toContain(`@media (display-mode: standalone) {
  html.merchant-mobile-document,
  html.merchant-mobile-document body {
    width: 100%;
    height: 100vh;
    min-height: 100vh;
  }
}`)
  })

  it('keeps every mobile sheet surface below the status-bar safe area', async () => {
    const styles = await readFile(new URL('../index.css', import.meta.url), 'utf8')

    expect(styles).toContain(
      '--merchant-route-sheet-top: calc(env(safe-area-inset-top) + 1.5rem)'
    )
    expect(styles).toContain('height: calc(100vh - var(--merchant-route-sheet-top))')
    expect(styles).toContain(
      '--merchant-floating-sheet-top: max(0.5rem, env(safe-area-inset-top))'
    )
    expect(styles).toMatch(
      /calc\(\s*100vh\s*-\s*var\(--merchant-floating-sheet-top\)\s*-\s*var\(--merchant-floating-sheet-bottom\)\s*\)/
    )
  })
})
