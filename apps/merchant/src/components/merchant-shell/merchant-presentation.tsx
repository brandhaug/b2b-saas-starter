import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  MOBILE_MERCHANT_PRESENTATION_QUERY,
  type MerchantPresentation
} from '@/lib/merchant-presentation.ts'

export type { MerchantPresentation } from '@/lib/merchant-presentation.ts'

const MerchantPresentationContext = createContext<MerchantPresentation | null>(null)

export function MerchantPresentationProvider({
  presentation,
  children
}: {
  readonly presentation: MerchantPresentation
  readonly children: ReactNode
}) {
  const [responsivePresentation, setResponsivePresentation] = useState(presentation)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(MOBILE_MERCHANT_PRESENTATION_QUERY)
    const synchronize = () =>
      setResponsivePresentation(media.matches ? 'mobile' : 'desktop')

    synchronize()
    media.addEventListener('change', synchronize)
    return () => media.removeEventListener('change', synchronize)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle(
      'merchant-mobile-document',
      responsivePresentation === 'mobile'
    )
    return () => document.documentElement.classList.remove('merchant-mobile-document')
  }, [responsivePresentation])

  return (
    <MerchantPresentationContext value={responsivePresentation}>
      {children}
    </MerchantPresentationContext>
  )
}

export function useMerchantPresentation(): MerchantPresentation {
  const presentation = useContext(MerchantPresentationContext)
  if (!presentation)
    throw new Error(
      'useMerchantPresentation must be used within MerchantPresentationProvider.'
    )
  return presentation
}

export function MerchantPresentationBoundary({
  desktop,
  mobile
}: {
  readonly desktop: ReactNode
  readonly mobile: ReactNode
}) {
  const presentation = useMerchantPresentation()
  return <>{presentation === 'mobile' ? mobile : desktop}</>
}
