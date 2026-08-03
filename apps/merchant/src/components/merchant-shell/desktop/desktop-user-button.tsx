import { Link } from '@tanstack/react-router'
import { MerchantAvatar } from '@/components/merchant-avatar.tsx'
import { merchantOverlayNavigationState } from '@/lib/merchant-home-route.ts'
import type { MerchantViewer } from '@/lib/merchant-viewer.ts'

export function DesktopUserButton({
  appointmentDate,
  interactive,
  viewer
}: {
  readonly appointmentDate: string | undefined
  readonly interactive: boolean
  readonly viewer: MerchantViewer | undefined
}) {
  const avatar = <MerchantAvatar size="compact" viewer={viewer} />

  if (!interactive)
    return (
      <span aria-hidden data-desktop-user-button="true" className="rounded-full p-1">
        {avatar}
      </span>
    )

  return (
    <Link
      to="/settings"
      search={appointmentDate ? { date: appointmentDate } : {}}
      state={(previous) => merchantOverlayNavigationState(previous, appointmentDate)}
      viewTransition={false}
      aria-label="Open Settings"
      data-desktop-user-button="true"
      className="rounded-full p-1 transition-transform active:scale-[0.98]"
    >
      {avatar}
    </Link>
  )
}
