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
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactNode
} from 'react'
import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'
import { customerInitials } from '@/features/customers/mobile-customer-contact-model.ts'
import { getCustomerDirectory } from '@/lib/server/appointment-operations.ts'
import {
  MobileAppointmentAddClient,
  MobileAppointmentClientPicker
} from './mobile-appointment-client-picker.tsx'
import type { AppointmentClient } from './mobile-appointment-client-model.ts'
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
  const [step, setStep] = useState<'appointment' | 'clients' | 'add-client'>(
    'appointment'
  )
  const [selectedClient, setSelectedClient] = useState<AppointmentClient | null>(null)
  const [customerDirectory, setCustomerDirectory] = useState<CustomerDirectory | null>(
    null
  )
  const [customerDirectoryState, setCustomerDirectoryState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const customerDirectoryRequestStarted = useRef(false)
  const componentMounted = useRef(false)

  useEffect(() => {
    componentMounted.current = true
    return () => {
      componentMounted.current = false
    }
  }, [])

  useEffect(() => {
    if (
      step !== 'clients' ||
      customerDirectoryRequestStarted.current ||
      customerDirectory
    )
      return
    customerDirectoryRequestStarted.current = true
    setCustomerDirectoryState('loading')
    void getCustomerDirectory()
      .then((directory) => {
        if (!componentMounted.current) return
        setCustomerDirectory(directory)
        setCustomerDirectoryState('ready')
      })
      .catch(() => {
        if (!componentMounted.current) return
        customerDirectoryRequestStarted.current = false
        setCustomerDirectoryState('error')
      })
  }, [customerDirectory, step])

  const activateDialog = useCallback(
    (dialog: HTMLDialogElement | null) => {
      sheetRef.current = dialog
      if (!dialog) return
      if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal()
      dialog.focus({ preventScroll: true })
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
        tabIndex={-1}
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
        className="merchant-route-sheet relative z-10 m-0 flex w-full max-w-none flex-col overflow-hidden rounded-t-[2.25rem] border-t bg-background p-0 text-inherit outline-none"
      >
        <button
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

        {step === 'clients' ? (
          <MobileAppointmentClientPicker
            directory={customerDirectory}
            loading={customerDirectoryState === 'loading'}
            error={customerDirectoryState === 'error'}
            selectedClient={selectedClient}
            onBack={() => setStep('appointment')}
            onAddClient={() => setStep('add-client')}
            onConfirm={(client) => {
              setSelectedClient(client)
              setStep('appointment')
            }}
          />
        ) : step === 'add-client' ? (
          <MobileAppointmentAddClient
            onBack={() => setStep('clients')}
            onSave={(client) => {
              setSelectedClient(client)
              setStep('appointment')
            }}
          />
        ) : (
          <AppointmentDraft
            notifyCustomer={notifyCustomer}
            selectedClient={selectedClient}
            onClose={() => sheet.closeSheet()}
            onChooseClient={() => setStep('clients')}
            onToggleNotify={() => setNotifyCustomer((current) => !current)}
          />
        )}
      </dialog>
    </div>
  )
}

function AppointmentDraft({
  notifyCustomer,
  selectedClient,
  onClose,
  onChooseClient,
  onToggleNotify
}: {
  readonly notifyCustomer: boolean
  readonly selectedClient: AppointmentClient | null
  readonly onClose: () => void
  readonly onChooseClient: () => void
  readonly onToggleNotify: () => void
}) {
  return (
    <MobileSheetScrollport className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <form
        data-mobile-new-appointment-form="true"
        className="flex min-h-full flex-col"
      >
        <header className="pt-1">
          <button
            type="button"
            aria-label="Close new appointment"
            className="-ml-2 grid size-11 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted active:text-foreground"
            onClick={onClose}
          >
            <X aria-hidden className="size-7" strokeWidth={1.6} />
          </button>
          <h1 className="mt-1 max-w-64 text-[2.35rem] leading-[1.05] font-bold tracking-[-0.035em]">
            Book an appointment
          </h1>
        </header>

        <div className="mt-4 divide-y divide-border/70 border-y border-border/70">
          <AppointmentFieldRow
            icon={
              selectedClient ? (
                <span className="grid size-8 place-items-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                  {customerInitials(selectedClient.name).slice(0, 2)}
                </span>
              ) : (
                <CircleUserRound />
              )
            }
            label={selectedClient?.name ?? 'Choose a client'}
            field="client"
            tone={selectedClient ? 'selected' : 'action'}
            onClick={onChooseClient}
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
            tone={selectedClient ? 'action' : 'disabled'}
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
          className="flex min-h-16 items-center gap-4 border-b border-border/70 text-left"
          onClick={onToggleNotify}
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
            className={`grid size-8 place-items-center rounded-full transition-colors ${
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
  )
}

function AppointmentFieldRow({
  icon,
  label,
  field,
  tone,
  onClick
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly field: string
  readonly tone: 'action' | 'disabled' | 'selected'
  readonly onClick?: MouseEventHandler<HTMLButtonElement> | undefined
}) {
  const disabled = tone === 'disabled'

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-mobile-new-appointment-field={field}
      className="group flex min-h-16 w-full items-center gap-4 text-left disabled:cursor-default"
    >
      <span className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-5 [&_svg]:stroke-[1.7]">
        {icon}
      </span>
      <span className="min-w-0 flex-1 py-2">
        <span
          className={`block truncate text-[1.0625rem] font-medium ${
            disabled
              ? 'text-muted-foreground'
              : tone === 'selected'
                ? 'text-foreground'
                : 'text-info'
          }`}
        >
          {label}
        </span>
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
