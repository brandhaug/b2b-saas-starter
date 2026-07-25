import {
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  Info,
  NotepadText,
  Repeat2,
  Scissors,
  X
} from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import { MobileSheetScrollport } from './mobile-sheet-scrollport.tsx'
import { useMobileRouteSheet } from './use-mobile-route-sheet.ts'

export function MobileNewAppointmentSheet({
  open,
  onRequestClose
}: {
  readonly open: boolean
  readonly onRequestClose: () => void
}) {
  if (!open) return null
  return <MobileNewAppointmentSheetDialog onRequestClose={onRequestClose} />
}

function MobileNewAppointmentSheetDialog({
  onRequestClose
}: {
  readonly onRequestClose: () => void
}) {
  const sheet = useMobileRouteSheet({ layout: 'sheet', onRequestClose })
  const sheetRef = sheet.sheetRef
  const [notifyCustomer, setNotifyCustomer] = useState(true)

  const activateDialog = useCallback(
    (dialog: HTMLDialogElement | null) => {
      sheetRef.current = dialog
      if (!dialog) return
      if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal()
      return () => {
        if (dialog.open && typeof dialog.close === 'function') dialog.close()
        sheetRef.current = null
      }
    },
    [sheetRef]
  )

  return (
    <div
      data-mobile-new-appointment-overlay="true"
      data-mobile-overlay-state={sheet.sheetState}
      className="merchant-mobile fixed inset-0 z-50 overflow-hidden text-foreground"
    >
      <dialog
        ref={activateDialog}
        aria-label="Book an appointment"
        aria-modal="true"
        data-mobile-surface="sheet"
        data-mobile-sheet-state={sheet.sheetState}
        data-mobile-new-appointment-sheet="true"
        onCancel={(event) => {
          event.preventDefault()
          sheet.closeSheet()
        }}
        onClickCapture={sheet.handleClickCapture}
        onTouchCancel={sheet.handleTouchCancel}
        onTouchEnd={sheet.handleTouchEnd}
        onTouchMove={sheet.handleTouchMove}
        onTouchStart={sheet.handleTouchStart}
        className="merchant-route-sheet relative z-10 m-0 flex w-full max-w-none flex-col overflow-hidden rounded-t-[2.25rem] border-t bg-background p-0 text-inherit"
      >
        <button
          ref={sheet.initialFocusRef}
          type="button"
          aria-label="Drag or tap to close new appointment"
          data-mobile-sheet-handle="true"
          className="merchant-sheet-drag-zone flex h-8 shrink-0 justify-center pt-3"
          onClick={sheet.handleCloseClick}
          onPointerDown={sheet.handlePointerDown}
          onPointerMove={sheet.handlePointerMove}
          onPointerUp={sheet.handlePointerUp}
          onPointerCancel={sheet.handlePointerCancel}
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </button>

        <MobileSheetScrollport className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <form
            data-mobile-new-appointment-form="true"
            className="flex min-h-full flex-col"
          >
            <header className="pt-1">
              <button
                type="button"
                aria-label="Close new appointment"
                className="-ml-2 grid size-11 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted active:text-foreground"
                onClick={() => sheet.closeSheet()}
              >
                <X aria-hidden className="size-7" strokeWidth={1.6} />
              </button>
              <h1 className="mt-8 max-w-64 text-[2.35rem] leading-[1.05] font-bold tracking-[-0.035em]">
                Book an appointment
              </h1>
            </header>

            <div className="mt-8 divide-y divide-border/70 border-y border-border/70">
              <AppointmentFieldRow
                icon={<CircleUserRound />}
                label="Choose a client"
                field="client"
                tone="action"
              />
              <AppointmentFieldRow
                icon={<Scissors />}
                label="Select a service"
                field="service"
                tone="action"
              />
              <AppointmentFieldRow
                icon={<CalendarDays />}
                label="Choose a time"
                field="time"
                tone="disabled"
              />
              <AppointmentFieldRow
                icon={<NotepadText />}
                label="Add appointment notes"
                field="appointment-notes"
                tone="action"
              />
              <AppointmentFieldRow
                icon={<Info />}
                label="Add client notes"
                field="client-notes"
                tone="disabled"
              />
              <AppointmentFieldRow
                icon={<Repeat2 />}
                label="Does not repeat"
                field="repeat"
                tone="action"
              />
            </div>

            <button
              type="button"
              aria-pressed={notifyCustomer}
              data-mobile-new-appointment-notify="true"
              className="flex min-h-18 items-center gap-4 border-b border-border/70 text-left"
              onClick={() => setNotifyCustomer((current) => !current)}
            >
              <Bell
                aria-hidden
                className="size-5 shrink-0 text-muted-foreground"
                strokeWidth={1.7}
              />
              <span className="min-w-0 flex-1 text-[1.0625rem] font-medium">
                Notify customer
              </span>
              <span
                aria-hidden
                className={`grid size-10 place-items-center rounded-full transition-colors ${
                  notifyCustomer
                    ? 'bg-info text-info-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {notifyCustomer ? <Check className="size-6" strokeWidth={2.2} /> : null}
              </span>
            </button>

            <div className="mt-auto pt-7">
              <button
                type="submit"
                disabled
                data-mobile-new-appointment-save="true"
                className="flex h-14 w-full items-center justify-center rounded-xl bg-muted text-[1.0625rem] font-semibold text-muted-foreground opacity-55"
              >
                Save appointment
              </button>
            </div>
          </form>
        </MobileSheetScrollport>
      </dialog>
    </div>
  )
}

function AppointmentFieldRow({
  icon,
  label,
  field,
  tone
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly field: string
  readonly tone: 'action' | 'disabled'
}) {
  const disabled = tone === 'disabled'

  return (
    <button
      type="button"
      disabled={disabled}
      data-mobile-new-appointment-field={field}
      className="group flex min-h-18 w-full items-center gap-4 text-left disabled:cursor-default"
    >
      <span className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-5 [&_svg]:stroke-[1.7]">
        {icon}
      </span>
      <span
        className={`min-w-0 flex-1 text-[1.0625rem] font-medium ${
          disabled ? 'text-muted-foreground' : 'text-info'
        }`}
      >
        {label}
      </span>
      {disabled ? null : (
        <ChevronRight
          aria-hidden
          className="size-5 shrink-0 text-muted-foreground transition-transform group-active:translate-x-0.5"
          strokeWidth={1.7}
        />
      )}
    </button>
  )
}
