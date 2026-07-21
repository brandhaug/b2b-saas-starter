import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef } from 'react'
import type { MerchantDestination } from '../navigation.tsx'
import { mobileSheetNavigationState } from './mobile-sheet-gesture.ts'

export function MobileNavigationSheet({
  destinations,
  appointmentDate,
  open,
  onRequestClose
}: {
  readonly destinations: readonly MerchantDestination[]
  readonly appointmentDate: string | undefined
  readonly open: boolean
  readonly onRequestClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="merchant-more-dialog"
      onCancel={(event) => {
        event.preventDefault()
        onRequestClose()
      }}
      onClose={() => {
        if (open) onRequestClose()
      }}
    >
      <button
        type="button"
        aria-label="Close merchant navigation"
        className="merchant-more-dismiss"
        onClick={onRequestClose}
      />
      <section className="merchant-more-panel">
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted-foreground/35" />
        <header className="grid grid-cols-[4rem_1fr_4rem] items-center px-5 pt-4 pb-3">
          <span aria-hidden />
          <h2 id={titleId} className="text-center text-base font-bold">
            Merchant areas
          </h2>
          <button
            type="button"
            className="min-h-11 justify-self-end px-1 text-sm font-bold text-primary"
            onClick={onRequestClose}
          >
            Done
          </button>
        </header>
        <nav aria-label="Merchant navigation" className="grid gap-2 px-4 pb-4">
          {destinations.map((destination) => (
            <Link
              key={destination.to}
              to={destination.to}
              viewTransition={false}
              state={mobileSheetNavigationState}
              search={appointmentDate ? { date: appointmentDate } : {}}
              className="flex min-h-14 items-center justify-between rounded-2xl border bg-card px-4 text-base font-bold text-foreground active:scale-[0.99] active:bg-muted"
              activeProps={{ className: 'border-primary/40 bg-accent text-primary' }}
            >
              {destination.label}
              <span aria-hidden className="text-muted-foreground">
                ›
              </span>
            </Link>
          ))}
        </nav>
      </section>
    </dialog>
  )
}
