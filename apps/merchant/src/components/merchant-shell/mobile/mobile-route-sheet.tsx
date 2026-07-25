import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { MobileSheetScrollport } from './mobile-sheet-scrollport.tsx'
import { useMobileRouteSheet } from './use-mobile-route-sheet.ts'

export function MobileRouteSheet({
  layout,
  title,
  children,
  onRequestBack,
  onRequestClose
}: {
  readonly layout: 'sheet' | 'task'
  readonly title: string
  readonly children: ReactNode
  readonly onRequestBack?: (() => void) | undefined
  readonly onRequestClose?: (() => void) | undefined
}) {
  const sheet = useMobileRouteSheet({ onRequestBack, onRequestClose })
  const sheetClassName =
    layout === 'task'
      ? 'merchant-route-sheet merchant-floating-sheet-panel z-10 m-0 flex max-w-none flex-col overflow-hidden border bg-background p-0 text-inherit'
      : 'merchant-route-sheet relative z-10 m-0 mt-6 flex h-[calc(100dvh-1.5rem)] max-h-[calc(100dvh-1.5rem)] w-full max-w-none flex-col overflow-hidden rounded-t-[2.25rem] border-t bg-background p-0 text-inherit'

  return (
    <div
      data-mobile-overlay-state={sheet.sheetState}
      className="merchant-mobile fixed inset-0 z-50 overflow-hidden text-foreground"
    >
      <dialog
        open
        ref={sheet.sheetRef}
        aria-labelledby="merchant-mobile-sheet-title"
        aria-modal="true"
        data-mobile-surface={layout}
        data-mobile-sheet-state={sheet.sheetState}
        onClickCapture={sheet.handleClickCapture}
        onTouchCancel={sheet.handleTouchCancel}
        onTouchEnd={sheet.handleTouchEnd}
        onTouchMove={sheet.handleTouchMove}
        onTouchStart={sheet.handleTouchStart}
        className={sheetClassName}
      >
        <button
          ref={sheet.initialFocusRef}
          type="button"
          aria-label={`Drag or tap to close ${title}`}
          data-mobile-sheet-handle="true"
          className="merchant-sheet-drag-zone -mb-2 flex h-9 shrink-0 justify-center pt-3"
          onClick={sheet.handleCloseClick}
          onPointerDown={sheet.handlePointerDown}
          onPointerMove={sheet.handlePointerMove}
          onPointerUp={sheet.handlePointerUp}
          onPointerCancel={sheet.handlePointerCancel}
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </button>
        <header className="merchant-sheet-safe-inline z-20 grid h-10 shrink-0 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center bg-background">
          {onRequestBack ? (
            <button
              type="button"
              aria-label="Back to Settings"
              className="grid size-10 place-items-center rounded-full text-foreground active:bg-muted"
              onClick={onRequestBack}
            >
              <ArrowLeft aria-hidden className="size-5" strokeWidth={1.8} />
            </button>
          ) : (
            <span aria-hidden />
          )}
          <h1
            id="merchant-mobile-sheet-title"
            className="min-w-0 truncate text-center text-[0.9375rem] leading-[1.375rem] font-semibold"
          >
            {title}
          </h1>
          <span aria-hidden />
        </header>
        <MobileSheetScrollport
          contentSized={layout === 'task'}
          className="merchant-sheet-safe-inline pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <div data-mobile-route-content="true" className="[&>*:first-child]:mt-0">
            {children}
          </div>
        </MobileSheetScrollport>
      </dialog>
    </div>
  )
}
