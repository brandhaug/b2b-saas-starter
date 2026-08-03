import { createFileRoute } from '@tanstack/react-router'
import { merchantPwaManifestResponse } from '@/lib/merchant-pwa'
import { resolvePublicBookingPage } from '@/lib/public-booking-page'
import { runCapabilities } from '@/lib/capabilities'

export const Route = createFileRoute('/merchant-manifest.webmanifest')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const merchantSlug = new URL(request.url).searchParams.get('merchant') ?? ''
        const result = await runCapabilities(resolvePublicBookingPage(merchantSlug))
        if (result.kind !== 'published')
          return new Response('Not found', { status: 404 })

        return merchantPwaManifestResponse({
          merchantSlug,
          publicName: result.page.publicName
        })
      }
    }
  }
})
