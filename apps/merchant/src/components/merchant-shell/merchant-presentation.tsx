import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'

export type { MerchantPresentation } from '@/lib/merchant-presentation.ts'

const MerchantPresentationContext = createContext<MerchantPresentation | null>(null)

export function MerchantPresentationProvider({
  presentation,
  children
}: {
  readonly presentation: MerchantPresentation
  readonly children: ReactNode
}) {
  return (
    <MerchantPresentationContext value={presentation}>
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
  return presentation === 'mobile' ? mobile : desktop
}
