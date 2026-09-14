import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const transitionClass = 'icon-transition absolute inset-0 inline-flex'

export function IconTransition({
  active,
  idle,
  activeIcon,
  'data-icon': dataIcon
}: {
  readonly active: boolean
  readonly idle: ReactNode
  readonly activeIcon: ReactNode
  readonly 'data-icon'?: 'inline-start' | 'inline-end'
}) {
  return (
    <span
      aria-hidden="true"
      data-icon={dataIcon}
      className="relative inline-flex size-4 items-center justify-center"
    >
      <span
        className={cn(
          transitionClass,
          active ? 'scale-25 opacity-0 blur-[4px]' : 'scale-100 opacity-100 blur-none'
        )}
      >
        {idle}
      </span>
      <span
        className={cn(
          transitionClass,
          active ? 'scale-100 opacity-100 blur-none' : 'scale-25 opacity-0 blur-[4px]'
        )}
      >
        {activeIcon}
      </span>
    </span>
  )
}
