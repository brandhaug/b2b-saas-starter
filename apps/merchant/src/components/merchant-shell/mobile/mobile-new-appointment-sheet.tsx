import {
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Info,
  Minus,
  NotepadText,
  Plus,
  Repeat2,
  Scissors,
  X
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type RefObject,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'
import type {
  MerchantCatalogSnapshot,
  ServiceRecord
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import type { Availability } from '@b2b-saas-starter/capabilities/scheduling'
import { customerInitials } from '@/features/customers/mobile-customer-contact-model.ts'
import { decodeCalendarDate } from '@/lib/appointment-calendar-date.ts'
import { getCustomerDirectory } from '@/lib/server/appointment-operations.ts'
import { getMerchantCatalog } from '@/lib/server/merchant-catalog.ts'
import { getAppointmentAvailability } from '@/lib/server/scheduling.ts'
import {
  MobileAppointmentAddClient,
  MobileAppointmentClientPicker
} from './mobile-appointment-client-picker.tsx'
import type { AppointmentClient } from './mobile-appointment-client-model.ts'
import { MobileAppointmentServicePicker } from './mobile-appointment-service-picker.tsx'
import { MobileSheetScrollport } from './mobile-sheet-scrollport.tsx'
import { useMobileRouteSheet } from './use-mobile-route-sheet.ts'

type NewAppointmentStep =
  | 'appointment'
  | 'appointment-notes'
  | 'client-notes'
  | 'clients'
  | 'add-client'
  | 'recurrence'
  | 'services'

export type NewAppointmentPresentation = 'desktop' | 'mobile'

type NewAppointmentDialogProps = {
  readonly open: boolean
  readonly appointmentDate?: string | undefined
  readonly onRequestClose: () => void
}

const ignoreNewAppointmentGesture = () => undefined

export function MobileNewAppointmentSheet({
  open,
  appointmentDate = new Date().toISOString().slice(0, 10),
  onRequestClose
}: NewAppointmentDialogProps) {
  const sheet = (
    <NewAppointmentDialog
      open={open}
      appointmentDate={appointmentDate}
      presentation="mobile"
      onRequestClose={onRequestClose}
    />
  )
  if (typeof document === 'undefined') return sheet
  const portal = document.querySelector<HTMLElement>(
    '[data-merchant-mobile-sheet-portal="true"]'
  )
  return portal ? createPortal(sheet, portal) : sheet
}

export function NewAppointmentDialog({
  open,
  appointmentDate = new Date().toISOString().slice(0, 10),
  presentation,
  onRequestClose
}: NewAppointmentDialogProps & {
  readonly presentation: NewAppointmentPresentation
}) {
  if (!open) return null
  if (presentation === 'desktop')
    return (
      <DesktopNewAppointmentSheetDialog
        appointmentDate={appointmentDate}
        onRequestClose={onRequestClose}
      />
    )
  return (
    <MobileNewAppointmentSheetDialog
      appointmentDate={appointmentDate}
      onRequestClose={onRequestClose}
    />
  )
}

function MobileNewAppointmentSheetDialog({
  appointmentDate,
  onRequestClose
}: {
  readonly appointmentDate: string
  readonly onRequestClose: () => void
}) {
  const sheet = useMobileRouteSheet({ layout: 'sheet', onRequestClose })
  return (
    <NewAppointmentSheetSurface
      appointmentDate={appointmentDate}
      presentation="mobile"
      sheet={sheet}
    />
  )
}

function DesktopNewAppointmentSheetDialog({
  appointmentDate,
  onRequestClose
}: {
  readonly appointmentDate: string
  readonly onRequestClose: () => void
}) {
  const sheet = useDesktopAppointmentDialogSurface(onRequestClose)
  return (
    <NewAppointmentSheetSurface
      appointmentDate={appointmentDate}
      presentation="desktop"
      sheet={sheet}
    />
  )
}

type NewAppointmentSheetController = Pick<
  ReturnType<typeof useMobileRouteSheet>,
  | 'closeSheet'
  | 'handleClickCapture'
  | 'handleCloseClick'
  | 'handlePointerCancel'
  | 'handlePointerDown'
  | 'handlePointerMove'
  | 'handlePointerUp'
  | 'handleTouchCancel'
  | 'handleTouchEnd'
  | 'handleTouchMove'
  | 'handleTouchStart'
  | 'sheetRef'
  | 'sheetState'
>

function NewAppointmentSheetSurface({
  appointmentDate,
  presentation,
  sheet
}: {
  readonly appointmentDate: string
  readonly presentation: NewAppointmentPresentation
  readonly sheet: NewAppointmentSheetController
}) {
  const sheetRef = sheet.sheetRef
  const [notifyCustomer, setNotifyCustomer] = useState(true)
  const [step, setStep] = useState<NewAppointmentStep>('appointment')
  const [selectedClient, setSelectedClient] = useState<AppointmentClient | null>(null)
  const [selectedService, setSelectedService] = useState<ServiceRecord | null>(null)
  const [durationMinutes, setDurationMinutes] = useState(0)
  const [selectedDate, setSelectedDate] = useState(() =>
    latestCalendarDate(decodeCalendarDate(appointmentDate), browserCalendarToday())
  )
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [repeatEveryWeeks, setRepeatEveryWeeks] = useState<number | null>(null)
  const [recurrencePickerOpen, setRecurrencePickerOpen] = useState(false)
  const [appointmentNote, setAppointmentNote] = useState('')
  const [clientNote, setClientNote] = useState('')
  const [customerDirectory, setCustomerDirectory] = useState<CustomerDirectory | null>(
    null
  )
  const [customerDirectoryState, setCustomerDirectoryState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [catalog, setCatalog] = useState<MerchantCatalogSnapshot | null>(null)
  const [catalogState, setCatalogState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [availabilityState, setAvailabilityState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const customerDirectoryRequestStarted = useRef(false)
  const catalogRequestStarted = useRef(false)
  const componentMounted = useRef(false)
  const stepContentRef = useRef<HTMLDivElement>(null)
  const stepOriginFocusRef = useRef<HTMLElement | null>(null)
  const stepOriginFieldRef = useRef<string | null>(null)

  const openStep = (
    nextStep: Exclude<NewAppointmentStep, 'appointment'>,
    originField?: string
  ) => {
    if (step === 'appointment' && document.activeElement instanceof HTMLElement) {
      stepOriginFocusRef.current = document.activeElement
      stepOriginFieldRef.current = originField ?? null
    }
    setStep(nextStep)
  }

  const returnToAppointment = () => setStep('appointment')

  useLayoutEffect(() => {
    if (presentation !== 'desktop') return
    if (step === 'appointment') {
      const origin = stepOriginFocusRef.current
      stepOriginFocusRef.current = null
      const field =
        stepOriginFieldRef.current ?? origin?.dataset.mobileNewAppointmentField
      stepOriginFieldRef.current = null
      const restoredOrigin = field
        ? stepContentRef.current?.querySelector<HTMLElement>(
            `[data-mobile-new-appointment-field="${field}"]`
          )
        : origin
      if (restoredOrigin?.isConnected) restoredOrigin.focus({ preventScroll: true })
      return
    }
    stepContentRef.current
      ?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled])'
      )
      ?.focus({ preventScroll: true })
  }, [presentation, step])

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

  useEffect(() => {
    if (step !== 'services' || catalogRequestStarted.current || catalog) return
    catalogRequestStarted.current = true
    setCatalogState('loading')
    void getMerchantCatalog()
      .then((snapshot) => {
        if (!componentMounted.current) return
        setCatalog(snapshot)
        setCatalogState('ready')
      })
      .catch(() => {
        if (!componentMounted.current) return
        catalogRequestStarted.current = false
        setCatalogState('error')
      })
  }, [catalog, step])

  useEffect(() => {
    if (!selectedService || !catalog) {
      setAvailability(null)
      setAvailabilityState('idle')
      return
    }
    const providerId = appointmentProviderId(catalog, selectedService)
    if (!providerId) {
      setAvailability(null)
      setAvailabilityState('error')
      return
    }
    let active = true
    setAvailabilityState('loading')
    void getAppointmentAvailability({
      data: {
        providerId,
        serviceId: selectedService.id,
        from: availabilityRangeStart(selectedDate),
        days: 3,
        durationMinutes
      }
    })
      .then((result) => {
        if (!active) return
        setAvailability(result)
        setAvailabilityState('ready')
      })
      .catch(() => {
        if (!active) return
        setAvailability(null)
        setAvailabilityState('error')
      })
    return () => {
      active = false
    }
  }, [catalog, durationMinutes, selectedDate, selectedService])

  useEffect(() => {
    if (!availability) return
    const merchantToday = calendarDateAtTimezone(
      new Date(Date.now()).toISOString(),
      availability.timezone
    )
    if (selectedDate >= merchantToday) return
    setSelectedDate(merchantToday)
    setSelectedTime(null)
  }, [availability, selectedDate])

  const activateDialog = useNewAppointmentDialogActivation(sheetRef, presentation)
  const desktop = presentation === 'desktop'

  return (
    <div
      data-mobile-new-appointment-overlay="true"
      data-mobile-overlay-state={sheet.sheetState}
      data-new-appointment-presentation={presentation}
      className={`merchant-mobile merchant-mobile-sheet-theme fixed inset-0 z-50 overflow-hidden text-foreground ${
        desktop ? 'merchant-desktop-new-appointment-overlay' : ''
      }`}
    >
      <dialog
        open={desktop ? undefined : true}
        ref={activateDialog}
        aria-label="Book an appointment"
        aria-modal="true"
        tabIndex={-1}
        data-mobile-surface="sheet"
        data-mobile-sheet-state={sheet.sheetState}
        data-mobile-new-appointment-sheet="true"
        data-new-appointment-presentation={presentation}
        onCancel={(event) => {
          event.preventDefault()
          sheet.closeSheet()
        }}
        onClickCapture={(event) => {
          if (desktop && event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect()
            const outside =
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            if (outside) sheet.closeSheet()
            return
          }
          sheet.handleClickCapture(event)
        }}
        onTouchCancel={desktop ? undefined : sheet.handleTouchCancel}
        onTouchEnd={desktop ? undefined : sheet.handleTouchEnd}
        onTouchMove={desktop ? undefined : sheet.handleTouchMove}
        onTouchStart={desktop ? undefined : sheet.handleTouchStart}
        className={`merchant-route-sheet relative z-10 m-0 flex w-full max-w-none flex-col overflow-hidden border-t bg-background p-0 text-inherit outline-none ${
          desktop
            ? 'merchant-desktop-new-appointment-dialog rounded-3xl border'
            : 'rounded-t-[2.25rem]'
        }`}
      >
        {desktop ? null : (
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
            <span
              aria-hidden
              className="h-1 w-10 rounded-full bg-muted-foreground/20"
            />
          </button>
        )}

        <div ref={stepContentRef} data-new-appointment-step={step} className="contents">
          {step === 'clients' ? (
            <MobileAppointmentClientPicker
              directory={customerDirectory}
              loading={customerDirectoryState === 'loading'}
              error={customerDirectoryState === 'error'}
              selectedClient={selectedClient}
              onBack={returnToAppointment}
              onAddClient={() => openStep('add-client')}
              onConfirm={(client) => {
                if (client.id !== selectedClient?.id) setClientNote('')
                setSelectedClient(client)
                returnToAppointment()
              }}
            />
          ) : step === 'add-client' ? (
            <MobileAppointmentAddClient
              onBack={() => openStep('clients')}
              onSave={(client) => {
                setSelectedClient(client)
                setClientNote(client.draftProfile?.notes ?? '')
                returnToAppointment()
              }}
            />
          ) : step === 'appointment-notes' ? (
            <MobileAppointmentNotesEditor
              kind="appointment"
              note={appointmentNote}
              onClose={returnToAppointment}
              onSave={(note) => {
                setAppointmentNote(note)
                returnToAppointment()
              }}
            />
          ) : step === 'client-notes' ? (
            <MobileAppointmentNotesEditor
              kind="client"
              note={clientNote}
              onClose={returnToAppointment}
              onSave={(note) => {
                setClientNote(note)
                returnToAppointment()
              }}
            />
          ) : step === 'recurrence' ? (
            <AppointmentRecurrencePicker
              presentation="desktop"
              selectedWeeks={repeatEveryWeeks}
              onClose={returnToAppointment}
              onConfirm={(weeks) => {
                setRepeatEveryWeeks(weeks)
                returnToAppointment()
              }}
            />
          ) : step === 'services' ? (
            <MobileAppointmentServicePicker
              services={
                catalog?.services.filter(
                  (service) =>
                    service.status === 'active' &&
                    service.eligibleProviderIds.length > 0
                ) ?? []
              }
              loading={catalogState === 'loading'}
              error={catalogState === 'error'}
              selectedService={selectedService}
              onBack={returnToAppointment}
              onConfirm={(service) => {
                setSelectedService(service)
                setDurationMinutes(service.durationMinutes)
                setSelectedTime(null)
                returnToAppointment()
              }}
            />
          ) : (
            <AppointmentDraft
              presentation={presentation}
              notifyCustomer={notifyCustomer}
              selectedClient={selectedClient}
              selectedService={selectedService}
              durationMinutes={durationMinutes}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              repeatEveryWeeks={repeatEveryWeeks}
              appointmentNote={appointmentNote}
              clientNote={clientNote}
              availability={availability}
              availabilityState={availabilityState}
              onClose={() => sheet.closeSheet()}
              onChooseClient={() => openStep('clients', 'client')}
              onChooseService={() => openStep('services', 'service')}
              onChangeDuration={(change) => {
                setDurationMinutes((current) => Math.max(15, current + change))
                setSelectedTime(null)
              }}
              onSelectDate={(date) => {
                if (date < minimumBookableDate(availability)) return
                setSelectedDate(date)
                setSelectedTime(null)
              }}
              onSelectTime={setSelectedTime}
              onChooseRepeat={() => {
                if (presentation === 'desktop') openStep('recurrence', 'repeat')
                else setRecurrencePickerOpen(true)
              }}
              onEditAppointmentNote={() =>
                openStep('appointment-notes', 'appointment-notes')
              }
              onEditClientNote={() => openStep('client-notes', 'client-notes')}
              onToggleNotify={() => setNotifyCustomer((current) => !current)}
            />
          )}
        </div>

        {recurrencePickerOpen && presentation === 'mobile' ? (
          <AppointmentRecurrencePicker
            presentation="mobile"
            selectedWeeks={repeatEveryWeeks}
            onClose={() => setRecurrencePickerOpen(false)}
            onConfirm={(weeks) => {
              setRepeatEveryWeeks(weeks)
              setRecurrencePickerOpen(false)
            }}
          />
        ) : null}
      </dialog>
    </div>
  )
}

function useDesktopAppointmentDialogSurface(
  onRequestClose: () => void
): NewAppointmentSheetController {
  const sheetRef = useRef<HTMLDialogElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [sheetState, setSheetState] = useState<'entering' | 'open' | 'closing'>(
    'entering'
  )

  useLayoutEffect(() => {
    const timer = window.setTimeout(() => setSheetState('open'), 200)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = previousOverflow
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  const closeSheet = useCallback(() => {
    if (sheetState === 'closing') return
    setSheetState('closing')
    closeTimerRef.current = window.setTimeout(onRequestClose, 200)
  }, [onRequestClose, sheetState])

  return {
    closeSheet,
    handleClickCapture: ignoreNewAppointmentGesture,
    handleCloseClick: closeSheet,
    handlePointerCancel: ignoreNewAppointmentGesture,
    handlePointerDown: ignoreNewAppointmentGesture,
    handlePointerMove: ignoreNewAppointmentGesture,
    handlePointerUp: ignoreNewAppointmentGesture,
    handleTouchCancel: ignoreNewAppointmentGesture,
    handleTouchEnd: ignoreNewAppointmentGesture,
    handleTouchMove: ignoreNewAppointmentGesture,
    handleTouchStart: ignoreNewAppointmentGesture,
    sheetRef,
    sheetState
  }
}

function useNewAppointmentDialogActivation(
  sheetRef: RefObject<HTMLDialogElement | null>,
  presentation: NewAppointmentPresentation
) {
  return useCallback(
    (dialog: HTMLDialogElement | null) => {
      sheetRef.current = dialog
      if (!dialog) return
      if (
        presentation === 'desktop' &&
        !dialog.open &&
        typeof dialog.showModal === 'function'
      ) {
        dialog.showModal()
      }
      dialog.focus({ preventScroll: true })
      return () => {
        if (dialog.open && typeof dialog.close === 'function') dialog.close()
        sheetRef.current = null
      }
    },
    [presentation, sheetRef]
  )
}

function AppointmentDraft({
  presentation,
  notifyCustomer,
  selectedClient,
  selectedService,
  durationMinutes,
  selectedDate,
  selectedTime,
  repeatEveryWeeks,
  appointmentNote,
  clientNote,
  availability,
  availabilityState,
  onClose,
  onChooseClient,
  onChooseService,
  onChangeDuration,
  onSelectDate,
  onSelectTime,
  onChooseRepeat,
  onEditAppointmentNote,
  onEditClientNote,
  onToggleNotify
}: {
  readonly presentation: NewAppointmentPresentation
  readonly notifyCustomer: boolean
  readonly selectedClient: AppointmentClient | null
  readonly selectedService: ServiceRecord | null
  readonly durationMinutes: number
  readonly selectedDate: string
  readonly selectedTime: string | null
  readonly repeatEveryWeeks: number | null
  readonly appointmentNote: string
  readonly clientNote: string
  readonly availability: Availability | null
  readonly availabilityState: 'idle' | 'loading' | 'ready' | 'error'
  readonly onClose: () => void
  readonly onChooseClient: () => void
  readonly onChooseService: () => void
  readonly onChangeDuration: (change: number) => void
  readonly onSelectDate: (date: string) => void
  readonly onSelectTime: (time: string) => void
  readonly onChooseRepeat: () => void
  readonly onEditAppointmentNote: () => void
  readonly onEditClientNote: () => void
  readonly onToggleNotify: () => void
}) {
  const [compactHeader, setCompactHeader] = useState(false)
  const canSave = Boolean(selectedClient && selectedService && selectedTime)
  const desktop = presentation === 'desktop'

  return (
    <div
      data-mobile-new-appointment-form="true"
      className="relative flex h-full min-h-0 flex-col"
    >
      {desktop ? (
        <header
          data-desktop-new-appointment-header="true"
          className="mt-4 mb-1 grid h-12 shrink-0 grid-cols-[2.5rem_1fr_2.5rem] items-center px-6"
        >
          <span aria-hidden />
          <h1 className="truncate text-center text-sm leading-5 font-medium">
            Book an appointment
          </h1>
          <button
            type="button"
            aria-label="Close new appointment"
            className="grid size-8 place-items-center justify-self-end rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X aria-hidden className="size-5" strokeWidth={1.6} />
          </button>
        </header>
      ) : (
        <div
          data-mobile-new-appointment-compact-header="true"
          data-visible={compactHeader ? 'true' : 'false'}
          className={`pointer-events-none absolute inset-x-0 top-0 z-30 flex h-14 items-center border-b border-border/70 bg-background/95 px-4 transition-opacity duration-150 ${
            compactHeader ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            type="button"
            aria-label="Close new appointment"
            tabIndex={compactHeader ? 0 : -1}
            className="pointer-events-auto -ml-2 grid size-11 place-items-center rounded-full text-muted-foreground active:bg-muted"
            onClick={onClose}
          >
            <X aria-hidden className="size-7" strokeWidth={1.6} />
          </button>
          <p className="ml-2 text-[1.125rem] font-semibold">Book an Appointment</p>
        </div>
      )}

      <MobileSheetScrollport
        className={desktop ? 'px-8' : 'px-4'}
        onScroll={(event) => setCompactHeader(event.currentTarget.scrollTop > 76)}
      >
        <div
          className={
            desktop
              ? 'pt-2 pb-24'
              : 'pb-[max(8rem,calc(env(safe-area-inset-bottom)+6.5rem))]'
          }
        >
          {desktop ? null : (
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
          )}

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

            {selectedService ? (
              <SelectedServiceSection
                service={selectedService}
                durationMinutes={durationMinutes}
                onChooseService={onChooseService}
                onChangeDuration={onChangeDuration}
              />
            ) : (
              <>
                <AppointmentFieldRow
                  icon={<Scissors />}
                  label="Select a service"
                  field="service"
                  tone="action"
                  onClick={onChooseService}
                />
                <AppointmentFieldRow
                  icon={<CalendarDays />}
                  label="Choose a time"
                  field="time"
                  tone="disabled"
                />
              </>
            )}
          </div>

          {selectedService ? (
            <AppointmentSchedulingSection
              availability={availability}
              availabilityState={availabilityState}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onSelectDate={onSelectDate}
              onSelectTime={onSelectTime}
            />
          ) : null}

          <div className="divide-y divide-border/70 border-b border-border/70">
            <AppointmentFieldRow
              icon={<NotepadText />}
              label={appointmentNote || 'Add appointment notes'}
              field="appointment-notes"
              tone={appointmentNote ? 'selected' : 'action'}
              onClick={onEditAppointmentNote}
            />
            <AppointmentFieldRow
              icon={<Info />}
              label={clientNote || 'Add client notes'}
              field="client-notes"
              tone={selectedClient ? (clientNote ? 'selected' : 'action') : 'disabled'}
              onClick={onEditClientNote}
            />
            <AppointmentFieldRow
              icon={<Repeat2 />}
              label={appointmentRepeatLabel(repeatEveryWeeks)}
              field="repeat"
              tone="action"
              onClick={onChooseRepeat}
            />
          </div>

          <button
            type="button"
            aria-pressed={notifyCustomer}
            data-mobile-new-appointment-notify="true"
            className="flex min-h-16 w-full items-center gap-4 border-b border-border/70 text-left"
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
        </div>
      </MobileSheetScrollport>

      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-background from-55% via-background/95 to-transparent pt-10 ${
          desktop ? 'px-8 pb-6' : 'px-4 pb-[max(1rem,env(safe-area-inset-bottom))]'
        }`}
      >
        <button
          type="button"
          disabled={!canSave}
          aria-disabled={!canSave}
          data-mobile-new-appointment-save-state={canSave ? 'ready' : 'incomplete'}
          data-mobile-new-appointment-save="true"
          className="pointer-events-auto flex h-14 w-full items-center justify-center rounded-xl bg-info text-[1.0625rem] font-semibold text-info-foreground transition-[opacity,transform] active:scale-[0.99] disabled:bg-muted disabled:text-muted-foreground disabled:opacity-65"
        >
          Save appointment
        </button>
      </div>
    </div>
  )
}

function MobileAppointmentNotesEditor({
  kind,
  note,
  onClose,
  onSave
}: {
  readonly kind: 'appointment' | 'client'
  readonly note: string
  readonly onClose: () => void
  readonly onSave: (note: string) => void
}) {
  const [draft, setDraft] = useState(note)
  const [visibleHeight, setVisibleHeight] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canSave = draft.trim().length > 0

  useLayoutEffect(() => {
    textareaRef.current?.focus({ preventScroll: true })
  }, [])

  useLayoutEffect(() => {
    const updateVisibleHeight = () => {
      const root = rootRef.current
      if (!root) return
      const viewport = window.visualViewport
      const viewportBottom =
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)
      const nextHeight = Math.max(
        240,
        Math.round(viewportBottom - root.getBoundingClientRect().top)
      )
      setVisibleHeight((current) => (current === nextHeight ? current : nextHeight))
    }

    updateVisibleHeight()
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', updateVisibleHeight)
    viewport?.addEventListener('scroll', updateVisibleHeight)
    window.addEventListener('orientationchange', updateVisibleHeight)
    return () => {
      viewport?.removeEventListener('resize', updateVisibleHeight)
      viewport?.removeEventListener('scroll', updateVisibleHeight)
      window.removeEventListener('orientationchange', updateVisibleHeight)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      data-mobile-appointment-notes={kind === 'appointment' ? 'true' : undefined}
      data-mobile-client-notes={kind === 'client' ? 'true' : undefined}
      className="relative flex min-h-0 flex-1 flex-col bg-background"
      style={
        visibleHeight === null ? undefined : { height: visibleHeight, flex: '0 0 auto' }
      }
    >
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border/70 bg-background px-2">
        <button
          type="button"
          aria-label={`Close ${kind} notes`}
          onClick={onClose}
          className="grid size-12 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted active:text-foreground"
        >
          <X aria-hidden className="size-7" strokeWidth={1.6} />
        </button>
        <h1 className="text-[1.25rem] font-semibold tracking-[-0.02em]">
          Notes for {kind}
        </h1>
      </header>

      <textarea
        ref={textareaRef}
        aria-label={`Notes for ${kind}`}
        data-mobile-appointment-notes-input={
          kind === 'appointment' ? 'true' : undefined
        }
        data-mobile-client-notes-input={kind === 'client' ? 'true' : undefined}
        value={draft}
        maxLength={2_000}
        spellCheck
        onChange={(event) => setDraft(event.target.value)}
        className="min-h-0 flex-1 resize-none bg-background px-5 py-4 text-[1.0625rem] leading-relaxed text-foreground caret-info outline-none placeholder:text-muted-foreground"
      />

      <div className="shrink-0 bg-linear-to-t from-background via-background to-transparent px-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          disabled={!canSave}
          data-mobile-appointment-notes-save={
            kind === 'appointment' ? 'true' : undefined
          }
          data-mobile-client-notes-save={kind === 'client' ? 'true' : undefined}
          onClick={() => onSave(draft.trim())}
          className="flex h-14 w-full items-center justify-center rounded-xl bg-info text-[1.0625rem] font-semibold text-info-foreground transition-[background-color,color,opacity,transform] active:scale-[0.99] disabled:bg-muted disabled:text-muted-foreground disabled:opacity-65"
        >
          Save note
        </button>
      </div>
    </div>
  )
}

const appointmentRecurrenceOptions = [1, 2, 3, 4, 5, 6, 7, 8] as const
const recurrenceRowHeight = 72

function AppointmentRecurrencePicker({
  presentation,
  selectedWeeks,
  onClose,
  onConfirm
}: {
  readonly presentation: NewAppointmentPresentation
  readonly selectedWeeks: number | null
  readonly onClose: () => void
  readonly onConfirm: (weeks: number) => void
}) {
  const initialWeeks = useRef(selectedWeeks ?? 4)
  const [draftWeeks, setDraftWeeks] = useState(initialWeeks.current)
  const [entered, setEntered] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const scrollport = scrollRef.current
    if (!scrollport) return
    scrollport.scrollTop = (initialWeeks.current - 1) * recurrenceRowHeight
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const chooseWeeks = (weeks: number) => {
    setDraftWeeks(weeks)
    const scrollport = scrollRef.current
    if (!scrollport) return
    const top = (weeks - 1) * recurrenceRowHeight
    if (typeof scrollport.scrollTo === 'function') {
      scrollport.scrollTo({ top, behavior: 'smooth' })
    } else {
      scrollport.scrollTop = top
    }
  }

  const recurrenceWheel = (
    <div
      ref={scrollRef}
      role="radiogroup"
      aria-label="Repeat frequency"
      data-mobile-recurrence-wheel="true"
      onScroll={(event) => {
        const weeks = Math.max(
          1,
          Math.min(
            8,
            Math.round(event.currentTarget.scrollTop / recurrenceRowHeight) + 1
          )
        )
        setDraftWeeks(weeks)
      }}
      className={`merchant-sheet-scrollport mt-4 h-[22.5rem] shrink-0 snap-y snap-mandatory overflow-y-auto overscroll-contain ${
        presentation === 'desktop' ? 'mx-8' : 'mx-4'
      }`}
      style={{
        WebkitMaskImage:
          'linear-gradient(transparent, black 22%, black 78%, transparent)'
      }}
    >
      <div aria-hidden className="h-36" />
      {appointmentRecurrenceOptions.map((weeks) => {
        const selected = weeks === draftWeeks
        const distance = Math.abs(weeks - draftWeeks)
        return (
          <label
            key={weeks}
            className={`block h-[4.5rem] w-full snap-center rounded-full text-[1.5rem] leading-none font-semibold transition-[background-color,color,opacity,transform] duration-150 ${
              selected
                ? 'scale-100 bg-muted text-foreground opacity-100'
                : distance === 1
                  ? 'scale-[0.96] text-muted-foreground opacity-60'
                  : 'scale-[0.92] text-muted-foreground opacity-20'
            }`}
          >
            <input
              type="radio"
              name="appointment-recurrence"
              value={weeks}
              checked={selected}
              aria-checked={selected}
              data-mobile-recurrence-weeks={weeks}
              onChange={() => chooseWeeks(weeks)}
              className="sr-only"
            />
            <span className="flex h-full items-center px-4 text-left">
              <span className="flex-1">{recurrenceOptionLabel(weeks)}</span>
              {selected ? (
                <span aria-hidden className="flex flex-col text-muted-foreground">
                  <ChevronDown className="size-4 rotate-180" strokeWidth={1.5} />
                  <ChevronDown className="-mt-1 size-4" strokeWidth={1.5} />
                </span>
              ) : null}
            </span>
          </label>
        )
      })}
      <div aria-hidden className="h-36" />
    </div>
  )

  const confirmButton = (
    <button
      type="button"
      data-mobile-recurrence-confirm="true"
      onClick={() => onConfirm(draftWeeks)}
      className="flex h-14 w-full items-center justify-center rounded-xl bg-info text-[1.0625rem] font-semibold text-info-foreground transition-transform active:scale-[0.99]"
    >
      Select
    </button>
  )

  if (presentation === 'desktop')
    return (
      <section
        data-desktop-new-appointment-recurrence="true"
        className="flex h-full min-h-0 flex-col bg-background"
      >
        <header className="mt-4 mb-1 grid h-12 shrink-0 grid-cols-[2.5rem_1fr_2.5rem] items-center px-6">
          <span aria-hidden />
          <h1 className="truncate text-center text-sm leading-5 font-medium">
            Set a frequency
          </h1>
          <button
            type="button"
            aria-label="Close recurrence picker"
            onClick={onClose}
            className="grid size-8 place-items-center justify-self-end rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden className="size-5" strokeWidth={1.6} />
          </button>
        </header>
        {recurrenceWheel}
        <div className="mt-auto px-8 pt-4 pb-6">{confirmButton}</div>
      </section>
    )

  return (
    <div
      data-mobile-recurrence-picker="true"
      className="absolute inset-0 z-40 overflow-hidden"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Close recurrence picker"
        onClick={onClose}
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
      />
      <dialog
        open
        aria-modal="true"
        aria-labelledby="appointment-recurrence-title"
        className={`absolute inset-x-0 bottom-0 m-0 flex h-[calc(100%-4rem)] max-h-[46rem] w-full max-w-none flex-col rounded-t-[2rem] border-t border-border bg-background p-0 text-inherit shadow-[0_-20px_50px_rgb(0_0_0/0.18)] transition-transform duration-300 ease-out ${entered ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <header className="flex shrink-0 items-center justify-between px-4 pt-5">
          <h2
            id="appointment-recurrence-title"
            className="text-[1.75rem] leading-tight font-medium tracking-[-0.025em]"
          >
            Set a frequency
          </h2>
          <button
            type="button"
            aria-label="Close recurrence picker"
            onClick={onClose}
            className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground transition-colors active:bg-muted/70 active:text-foreground"
          >
            <X aria-hidden className="size-7" strokeWidth={1.6} />
          </button>
        </header>

        {recurrenceWheel}

        <div className="mt-auto px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {confirmButton}
        </div>
      </dialog>
    </div>
  )
}

function recurrenceOptionLabel(weeks: number) {
  return weeks === 1 ? 'Weekly' : `${weeks} weeks`
}

function appointmentRepeatLabel(weeks: number | null) {
  if (weeks === null) return 'Does not repeat'
  if (weeks === 1) return 'Every week'
  return `Every ${weeks} weeks`
}

function AppointmentSchedulingSection({
  availability,
  availabilityState,
  selectedDate,
  selectedTime,
  onSelectDate,
  onSelectTime
}: {
  readonly availability: Availability | null
  readonly availabilityState: 'idle' | 'loading' | 'ready' | 'error'
  readonly selectedDate: string
  readonly selectedTime: string | null
  readonly onSelectDate: (date: string) => void
  readonly onSelectTime: (time: string) => void
}) {
  const dates = appointmentDateStrip(selectedDate)
  const allTimes = appointmentTimes(availability, selectedDate)
  const minimumDate = minimumBookableDate(availability)

  return (
    <section className="border-b border-border/70 py-5">
      <label className="relative flex min-h-12 w-full items-center gap-4 text-left">
        <CalendarDays
          aria-hidden
          className="size-5 shrink-0 text-muted-foreground"
          strokeWidth={1.7}
        />
        <span className="min-w-0 flex-1 text-[1.125rem] font-medium">
          {formatDraftDate(selectedDate)}
        </span>
        <ChevronDown
          aria-hidden
          className="size-5 text-muted-foreground"
          strokeWidth={1.7}
        />
        <input
          type="date"
          aria-label="Choose appointment date"
          value={selectedDate}
          min={minimumDate}
          onChange={(event) => {
            if (event.target.value) onSelectDate(event.target.value)
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <div aria-label="Appointment date" className="mt-3 grid grid-cols-7 gap-1">
        {dates.map((date) => {
          const selected = date.value === selectedDate
          const disabled = date.value < minimumDate
          return (
            <button
              key={date.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              data-mobile-appointment-date={date.value}
              onClick={() => onSelectDate(date.value)}
              className={`flex min-h-[4.6rem] flex-col items-center justify-center rounded-full text-center transition-colors ${
                selected
                  ? 'bg-info text-info-foreground'
                  : disabled
                    ? 'text-muted-foreground/35'
                    : 'text-muted-foreground active:bg-muted'
              }`}
            >
              <span className="text-xs font-semibold uppercase">{date.weekday}</span>
              <span className="mt-2 text-lg leading-none font-semibold">
                {date.day}
              </span>
              <span
                aria-hidden
                className={`mt-1 size-1 rounded-full ${
                  selected ? 'bg-current' : 'bg-transparent'
                }`}
              />
            </button>
          )
        })}
      </div>

      <h2 className="mt-5 text-[1.25rem] font-medium">Choose a time</h2>
      {availabilityState === 'loading' ? (
        <p className="mt-3 text-sm text-muted-foreground">Checking availability…</p>
      ) : availabilityState === 'error' ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Availability could not be loaded. Try another date.
        </p>
      ) : allTimes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No available times on this day.
        </p>
      ) : (
        <div
          data-mobile-appointment-time-grid="true"
          className="mt-4 grid grid-cols-[repeat(3,minmax(0,6.8125rem))] justify-between gap-x-2 gap-y-2.5"
        >
          {allTimes.map((time) => {
            const selected = selectedTime === time.instant
            return (
              <button
                key={time.instant}
                type="button"
                aria-pressed={selected}
                data-mobile-appointment-time={time.value}
                onClick={() => onSelectTime(time.instant)}
                className={`flex h-12 min-w-0 items-center justify-center rounded-xl border px-2 text-[0.9375rem] leading-[1.125rem] font-semibold tracking-[-0.015rem] transition-[border-color,background-color,box-shadow,color,transform] duration-150 active:scale-[0.98] ${
                  selected
                    ? 'border-info bg-info text-info-foreground'
                    : 'border-border bg-transparent hover:bg-background hover:shadow-[0_8px_16px_-5px_rgb(0_0_0/0.1)]'
                }`}
              >
                <span
                  aria-hidden
                  className={`mr-2 size-2.5 shrink-0 rounded-t-full ${
                    selected ? 'bg-info-foreground' : 'bg-warning'
                  }`}
                />
                {time.label}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function SelectedServiceSection({
  service,
  durationMinutes,
  onChooseService,
  onChangeDuration
}: {
  readonly service: ServiceRecord
  readonly durationMinutes: number
  readonly onChooseService: () => void
  readonly onChangeDuration: (change: number) => void
}) {
  return (
    <section data-mobile-appointment-duration="true" className="py-4">
      <button
        type="button"
        data-mobile-new-appointment-field="service"
        onClick={onChooseService}
        className="flex w-full items-start gap-4 text-left"
      >
        <Scissors
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          strokeWidth={1.7}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-3">
            <span className="truncate text-[1.0625rem] font-semibold">
              {service.name}
            </span>
            <span className="shrink-0 text-[1.0625rem] font-medium">
              {durationMinutes} min
            </span>
          </span>
          <span className="mt-2 block text-[1.0625rem] font-medium text-info">
            Change selected service
          </span>
        </span>
      </button>

      <div className="mt-4 flex items-center gap-4 border-t border-border/70 pt-4">
        <Clock3
          aria-hidden
          className="size-5 shrink-0 text-muted-foreground"
          strokeWidth={1.7}
        />
        <span className="min-w-0 flex-1 text-[1.0625rem] font-medium">
          Appointment duration
        </span>
        <span className="text-[1.0625rem] font-medium">{durationMinutes} min</span>
      </div>
      <div className="mt-3 ml-9 flex gap-2">
        <button
          type="button"
          disabled={durationMinutes <= 15}
          aria-label="Reduce appointment duration by 15 minutes"
          onClick={() => onChangeDuration(-15)}
          className="flex h-11 min-w-28 items-center justify-center gap-1 rounded-xl border border-border px-3 text-sm font-semibold disabled:text-muted-foreground"
        >
          <Minus aria-hidden className="size-4" />
          15 min
        </button>
        <button
          type="button"
          aria-label="Increase appointment duration by 15 minutes"
          onClick={() => onChangeDuration(15)}
          className="flex h-11 min-w-28 items-center justify-center gap-1 rounded-xl border border-border px-3 text-sm font-semibold active:bg-muted"
        >
          <Plus aria-hidden className="size-4" />
          15 min
        </button>
      </div>
    </section>
  )
}

const weekdayFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'narrow',
  timeZone: 'UTC'
})

const draftDateFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
})

const calendarDateFormatters = new Map<string, Intl.DateTimeFormat>()
const appointmentTimeValueFormatters = new Map<string, Intl.DateTimeFormat>()
const appointmentTimeLabelFormatters = new Map<string, Intl.DateTimeFormat>()

function browserCalendarToday() {
  const now = new Date(Date.now())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function latestCalendarDate(left: string, right: string) {
  return left >= right ? left : right
}

function minimumBookableDate(availability: Availability | null) {
  if (!availability) return browserCalendarToday()
  return calendarDateAtTimezone(
    new Date(Date.now()).toISOString(),
    availability.timezone
  )
}

function availabilityRangeStart(selectedDate: string) {
  const start = new Date(`${decodeCalendarDate(selectedDate)}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - 1)
  return start.toISOString()
}

function timezoneFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  timezone: string,
  locale: string,
  options: Intl.DateTimeFormatOptions
) {
  const cached = cache.get(timezone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: timezone
  })
  cache.set(timezone, formatter)
  return formatter
}

function appointmentDateStrip(selectedDate: string) {
  const selected = new Date(`${decodeCalendarDate(selectedDate)}T12:00:00.000Z`)
  const monday = new Date(selected)
  monday.setUTCDate(selected.getUTCDate() - ((selected.getUTCDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(monday)
    value.setUTCDate(monday.getUTCDate() + index)
    return {
      value: value.toISOString().slice(0, 10),
      weekday: weekdayFormatter.format(value),
      day: value.getUTCDate()
    }
  })
}

function formatDraftDate(date: string) {
  return draftDateFormatter.format(
    new Date(`${decodeCalendarDate(date)}T12:00:00.000Z`)
  )
}

function appointmentProviderId(
  catalog: MerchantCatalogSnapshot,
  service: ServiceRecord
) {
  const eligible = new Set(service.eligibleProviderIds)
  return (
    catalog.providers.find(
      (provider) =>
        provider.status === 'active' && provider.isDefault && eligible.has(provider.id)
    )?.id ??
    catalog.providers.find(
      (provider) => provider.status === 'active' && eligible.has(provider.id)
    )?.id ??
    null
  )
}

function calendarDateAtTimezone(instant: string, timezone: string) {
  const parts = timezoneFormatter(calendarDateFormatters, timezone, 'en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(instant))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function appointmentTimes(availability: Availability | null, selectedDate: string) {
  if (!availability) return []
  const valueFormatter = timezoneFormatter(
    appointmentTimeValueFormatters,
    availability.timezone,
    'en-GB',
    {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }
  )
  const labelFormatter = timezoneFormatter(
    appointmentTimeLabelFormatters,
    availability.timezone,
    'en-US',
    {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }
  )
  const times = []
  for (const slot of availability.slots) {
    if (Date.parse(slot.startsAt) <= Date.now()) continue
    if (calendarDateAtTimezone(slot.startsAt, availability.timezone) !== selectedDate)
      continue
    const instant = new Date(slot.startsAt)
    times.push({
      instant: slot.startsAt,
      value: valueFormatter.format(instant),
      label: labelFormatter.format(instant).replace(/\s/g, '').toLowerCase()
    })
  }
  return times.sort((left, right) => left.instant.localeCompare(right.instant))
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
      <span
        className={`grid shrink-0 place-items-center text-muted-foreground [&_svg]:size-5 [&_svg]:stroke-[1.7] ${
          tone === 'selected' ? 'size-8' : 'size-5'
        }`}
      >
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
