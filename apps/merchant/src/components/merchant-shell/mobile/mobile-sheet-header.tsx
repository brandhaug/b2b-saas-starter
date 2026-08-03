import { X } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export function MobileSheetDragHandle({
  label,
  ...buttonProps
}: Omit<
  ComponentPropsWithoutRef<'button'>,
  'aria-label' | 'children' | 'className' | 'type'
> & {
  readonly label: string
}) {
  return (
    <button
      {...buttonProps}
      type="button"
      aria-label={label}
      data-mobile-sheet-handle="true"
      className="merchant-sheet-drag-zone -mb-2 flex h-9 shrink-0 justify-center pt-3"
    >
      <span aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/20" />
    </button>
  )
}

export function MobileSheetCloseButton({
  label,
  onClick
}: {
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-10 place-items-center rounded-full text-foreground active:bg-muted"
    >
      <X aria-hidden className="size-5" strokeWidth={1.8} />
    </button>
  )
}

export function MobileSheetHeader({
  title,
  leading,
  titleVisible = true,
  divider = false,
  titleAs = 'h1',
  headerDataAttribute,
  titleDataAttribute
}: {
  readonly title: string
  readonly leading?: ReactNode
  readonly titleVisible?: boolean
  readonly divider?: boolean
  readonly titleAs?: 'h1' | 'p'
  readonly headerDataAttribute?: `data-${string}` | undefined
  readonly titleDataAttribute?: `data-${string}` | undefined
}) {
  const HeaderTitle = titleAs
  const headerData = headerDataAttribute ? { [headerDataAttribute]: 'true' } : {}
  const titleData = titleDataAttribute ? { [titleDataAttribute]: 'true' } : {}

  return (
    <header
      {...headerData}
      data-mobile-sheet-header="true"
      data-visible={titleVisible ? 'true' : 'false'}
      className={`merchant-sheet-safe-inline relative z-20 grid h-10 shrink-0 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center bg-background transition-colors duration-150 ${
        divider ? 'border-b border-border/70' : 'border-b-0 border-transparent'
      }`}
    >
      {leading ?? <span aria-hidden />}
      <HeaderTitle
        {...titleData}
        aria-hidden={!titleVisible}
        data-visible={titleVisible ? 'true' : 'false'}
        className={`min-w-0 truncate text-center text-[0.9375rem] leading-[1.375rem] font-semibold transition-opacity duration-150 ${
          titleVisible ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        {title}
      </HeaderTitle>
      <span aria-hidden />
    </header>
  )
}
