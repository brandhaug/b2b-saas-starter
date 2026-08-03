export interface MerchantPwaManifest {
  readonly id: string
  readonly name: string
  readonly short_name: string
  readonly description: string
  readonly start_url: string
  readonly scope: string
  readonly display: 'standalone'
  readonly background_color: string
  readonly theme_color: string
  readonly icons: ReadonlyArray<{
    readonly src: string
    readonly sizes: string
    readonly type: 'image/png'
    readonly purpose: 'any' | 'maskable'
  }>
}

export const createMerchantPwaManifest = ({
  merchantSlug,
  publicName
}: {
  readonly merchantSlug: string
  readonly publicName: string
}): MerchantPwaManifest => {
  const merchantPath = `/${merchantSlug}/`

  return {
    id: `/${merchantSlug}`,
    name: `${publicName} bookings`,
    short_name: publicName,
    description: `Book an appointment with ${publicName}.`,
    start_url: merchantPath,
    scope: merchantPath,
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      {
        src: '/pwa-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/pwa-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  }
}

export const merchantPwaManifestResponse = (
  merchant: Parameters<typeof createMerchantPwaManifest>[0]
): Response =>
  Response.json(createMerchantPwaManifest(merchant), {
    headers: {
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      'Content-Type': 'application/manifest+json'
    }
  })
