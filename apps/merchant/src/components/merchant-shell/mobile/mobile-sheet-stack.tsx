import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { MerchantShellSection } from '../navigation.tsx'
import { useMerchantPresentation } from '../merchant-presentation.tsx'

export type MobileSheetDescriptor = {
  readonly section: MerchantShellSection
  readonly title: string
  readonly description: string
  readonly layout: 'sheet' | 'task'
}

type MobileSheetStackValue = {
  readonly enabled: boolean
  readonly menuOpen: boolean
  readonly descriptor: MobileSheetDescriptor | null
  readonly openMenu: () => void
  readonly closeMenu: () => void
  readonly registerRoute: (descriptor: MobileSheetDescriptor) => void
}

const MobileSheetStackContext = createContext<MobileSheetStackValue | null>(null)

export function MobileSheetStackProvider({
  children
}: {
  readonly children: ReactNode
}) {
  const enabled = useMerchantPresentation() === 'mobile'
  const [menuOpen, setMenuOpen] = useState(false)
  const [descriptor, setDescriptor] = useState<MobileSheetDescriptor | null>(null)
  const openMenu = useCallback(() => setMenuOpen(true), [])
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const registerRoute = useCallback((next: MobileSheetDescriptor) => {
    setDescriptor((current) =>
      current?.title === next.title &&
      current.description === next.description &&
      current.layout === next.layout &&
      current.section.kind === next.section.kind &&
      (current.section.kind !== 'catalog' ||
        (next.section.kind === 'catalog' &&
          current.section.presentation === next.section.presentation))
        ? current
        : next
    )
  }, [])
  const value = useMemo<MobileSheetStackValue>(
    () => ({
      enabled,
      menuOpen,
      descriptor,
      openMenu,
      closeMenu,
      registerRoute
    }),
    [closeMenu, descriptor, enabled, menuOpen, openMenu, registerRoute]
  )

  return <MobileSheetStackContext value={value}>{children}</MobileSheetStackContext>
}

export function useMobileSheetStack() {
  return useContext(MobileSheetStackContext)
}

export function useMobileSheetRouteRegistration(
  descriptor: MobileSheetDescriptor | null
) {
  const stack = useMobileSheetStack()

  useLayoutEffect(() => {
    if (!stack?.enabled || !descriptor) return
    stack.registerRoute(descriptor)
  }, [descriptor, stack])

  return stack?.enabled === true
}

export function useDesktopDialogRouteRegistration(
  descriptor: MobileSheetDescriptor | null
) {
  const stack = useMobileSheetStack()

  useLayoutEffect(() => {
    if (stack?.enabled !== false || !descriptor) return
    stack.registerRoute(descriptor)
  }, [descriptor, stack])

  return stack?.enabled === false
}
