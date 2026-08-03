import type { MerchantViewer } from '@/lib/merchant-viewer.ts'

export function MerchantAvatar({
  size,
  viewer
}: {
  readonly size: 'compact' | 'profile'
  readonly viewer: MerchantViewer | undefined
}) {
  const dimensions = size === 'profile' ? 64 : 36
  const sizeClass = size === 'profile' ? 'size-16' : 'size-9'
  const textClass =
    size === 'profile' ? 'text-3xl font-medium' : 'text-sm font-semibold'

  return (
    <span
      className={`pointer-events-none relative flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-600 text-white`}
    >
      {viewer?.image ? (
        <img
          src={viewer.image}
          alt="Avatar"
          className="h-full w-full select-none object-cover"
          draggable={false}
          width={dimensions}
          height={dimensions}
        />
      ) : (
        <span aria-hidden className={`${textClass} tracking-[-0.02em] uppercase`}>
          {merchantViewerInitials(viewer?.name)}
        </span>
      )}
    </span>
  )
}

function merchantViewerInitials(name: string | undefined) {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0]!.slice(0, 1)
  return `${parts[0]!.slice(0, 1)}${parts.at(-1)!.slice(0, 1)}`
}
