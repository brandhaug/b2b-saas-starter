import { createContext, useContext, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'

export type { MerchantPresentation } from '@/lib/merchant-presentation.ts'

const MerchantPresentationContext = createContext<MerchantPresentation | null>(null)
type MobileHomeUnderlayOrigin = 'none' | 'reconstructed' | 'retained'
type MobileHomeUnderlay = {
  readonly content: RefObject<ReactNode>
  readonly date: RefObject<string | undefined>
  readonly origin: RefObject<MobileHomeUnderlayOrigin>
}
const MobileHomeUnderlayContext = createContext<MobileHomeUnderlay | null>(null)

export function MerchantPresentationProvider({
  presentation,
  mobileHomeUnderlay,
  mobileHomeDate,
  children
}: {
  readonly presentation: MerchantPresentation
  readonly mobileHomeUnderlay?: ReactNode
  readonly mobileHomeDate?: string | undefined
  readonly children: ReactNode
}) {
  const [initialPresentation] = useState(presentation)
  const mobileHomeUnderlayRef = useRef<ReactNode>(mobileHomeUnderlay ?? null)
  const mobileHomeDateRef = useRef<string | undefined>(mobileHomeDate)
  const mobileHomeUnderlayOriginRef = useRef<MobileHomeUnderlayOrigin>(
    mobileHomeUnderlay === undefined ? 'none' : 'reconstructed'
  )
  return (
    <MerchantPresentationContext value={initialPresentation}>
      <MobileHomeUnderlayContext
        value={{
          content: mobileHomeUnderlayRef,
          date: mobileHomeDateRef,
          origin: mobileHomeUnderlayOriginRef
        }}
      >
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
