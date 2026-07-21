import { createContext, useContext, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'

export type { MerchantPresentation } from '@/lib/merchant-presentation.ts'

const MerchantPresentationContext = createContext<MerchantPresentation | null>(null)
const MobileHomeUnderlayContext = createContext<RefObject<ReactNode> | null>(null)

export function MerchantPresentationProvider({
  presentation,
  children
}: {
  readonly presentation: MerchantPresentation
  readonly children: ReactNode
}) {
  const [initialPresentation] = useState(presentation)
  const mobileHomeUnderlayRef = useRef<ReactNode>(null)
  return (
    <MerchantPresentationContext value={initialPresentation}>
      <MobileHomeUnderlayContext value={mobileHomeUnderlayRef}>
        {children}
      </MobileHomeUnderlayContext>
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

export function useMobileHomeUnderlay() {
  return useContext(MobileHomeUnderlayContext)
}

export function MerchantPresentationBoundary({
  desktop,
  mobile
}: {
  readonly desktop: ReactNode
  readonly mobile: ReactNode
}) {
  const presentation = useMerchantPresentation()
  return presentation === 'mobile' ? mobile : desktop
}
