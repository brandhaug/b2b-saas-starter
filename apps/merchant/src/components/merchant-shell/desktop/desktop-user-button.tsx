import { Link } from '@tanstack/react-router'
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
  const avatar = <DesktopUserAvatar viewer={viewer} />

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

function DesktopUserAvatar({
  viewer
}: {
  readonly viewer: MerchantViewer | undefined
}) {
  return (
    <span className="pointer-events-none relative flex size-9 items-center justify-center overflow-hidden rounded-full bg-muted">
      {viewer?.image ? (
        <img
          src={viewer.image}
          alt="Avatar"
          className="h-full w-full select-none object-cover"
          draggable={false}
          width={36}
          height={36}
        />
      ) : (
        <span
          aria-hidden
          className="text-sm font-semibold tracking-[-0.02em] text-foreground uppercase"
        >
          {viewerInitials(viewer?.name)}
        </span>
      )}
    </span>
  )
}

function viewerInitials(name: string | undefined) {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0]!.slice(0, 1)
  return `${parts[0]!.slice(0, 1)}${parts.at(-1)!.slice(0, 1)}`
}
