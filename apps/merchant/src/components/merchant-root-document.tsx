import type { ReactNode } from 'react'
import { HeadContent, Scripts } from '@tanstack/react-router'
import { domMax, LazyMotion } from 'motion/react'
import { DevFpsPill } from '@/components/dev-fps-pill.tsx'
import { MerchantPwaRegistration } from '@/components/merchant-pwa-registration.tsx'
import { MerchantThemeSync } from '@/components/merchant-theme-sync.tsx'
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'
import { MERCHANT_PWA_VIEWPORT } from '@/lib/merchant-pwa.ts'
import { merchantThemeBootScript } from '@/lib/merchant-theme.ts'

export function MerchantRootDocument({
  presentation,
  children
}: {
  readonly presentation: MerchantPresentation
  readonly children: ReactNode
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={
        presentation === 'mobile'
          ? 'merchant-mobile-document antialiased'
          : 'antialiased'
      }
    >
      <head>
        <meta name="viewport" content={MERCHANT_PWA_VIEWPORT} />
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: merchantThemeBootScript }} />
      </head>
      <body>
        <LazyMotion features={domMax}>
          <MerchantThemeSync />
          <MerchantPwaRegistration />
          {children}
          {import.meta.env.DEV ? <DevFpsPill /> : null}
          <Scripts />
        </LazyMotion>
      </body>
    </html>
  )
}
