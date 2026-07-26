import { useLocation, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { DesktopSecondaryDialogRoute } from '@/components/merchant-shell/desktop/desktop-secondary-dialog-route.tsx'
import { merchantHomeDate } from '@/lib/merchant-home-date.ts'

export function MerchantSettingsDetailRoute({
  children,
  contentRevision,
  id,
  title
}: {
  readonly children: ReactNode
  readonly contentRevision?: string | number | undefined
  readonly id: string
  readonly title: string
}) {
  const location = useLocation()
  const router = useRouter()
  const appointmentDate = merchantHomeDate(location.search, location.state)

  return (
    <DesktopSecondaryDialogRoute
      id={id}
      title={title}
      contentRevision={contentRevision}
      onAfterClose={() => {
        void router.navigate({
          to: '/settings',
          search: appointmentDate ? { date: appointmentDate } : {},
          replace: true,
          viewTransition: false
        })
      }}
    >
      {children}
    </DesktopSecondaryDialogRoute>
  )
}
