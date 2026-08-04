import {
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
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
import type { CustomerDirectoryView } from '@/features/customers/customer-contact-model.ts'
import type {
  MerchantCatalogSnapshot,
  ServiceRecord
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  civilTimeInstants,
  type Availability
} from '@b2b-saas-starter/capabilities/scheduling'
import { customerInitials } from '@/features/customers/customer-contact-model.ts'
import { decodeCalendarDate } from '@/lib/appointment-calendar-date.ts'
import { searchCustomerRecords } from '@/lib/server/customer-directory.ts'
import { getMerchantCatalog } from '@/lib/server/merchant-catalog.ts'
import { getAppointmentAvailability } from '@/lib/server/scheduling.ts'
import {
  previewAppointmentSeries,
  runAppointmentCommand
} from '@/lib/server/appointment-operations.ts'
import {
  MobileAppointmentAddClient,
  MobileAppointmentClientPicker
} from './mobile-appointment-client-picker.tsx'
import type { AppointmentClient } from './mobile-appointment-client-model.ts'
import { MobileAppointmentServicePicker } from './mobile-appointment-service-picker.tsx'
import { MobileSheetScrollport } from './mobile-sheet-scrollport.tsx'
import {
  MobileSheetCloseButton,
  MobileSheetDragHandle,
  MobileSheetHeader
} from './mobile-sheet-header.tsx'
import { useMobileCollapsingSheetTitle } from './use-mobile-collapsing-sheet-title.ts'
import { useMobileRouteSheet } from './use-mobile-route-sheet.ts'
import type { AppointmentCreateMode } from '../appointment-create-mode.ts'

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
  readonly mode?: AppointmentCreateMode
  readonly onRequestClose: () => void
}

const ignoreNewAppointmentGesture = () => undefined
const desktopMotionReduced = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false

export function MobileNewAppointmentSheet({
  open,
  appointmentDate = new Date().toISOString().slice(0, 10),
  mode = 'appointment',
  onRequestClose
}: NewAppointmentDialogProps) {
  const sheet = (
    <NewAppointmentDialog
      open={open}
      appointmentDate={appointmentDate}
      mode={mode}
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
  mode = 'appointment',
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
        mode={mode}
        onRequestClose={onRequestClose}
      />
    )
  return (
    <MobileNewAppointmentSheetDialog
      appointmentDate={appointmentDate}
      mode={mode}
      onRequestClose={onRequestClose}
    />
  )
}

function MobileNewAppointmentSheetDialog({
  appointmentDate,
  mode,
  onRequestClose
}: {
  readonly appointmentDate: string
  readonly mode: AppointmentCreateMode
  readonly onRequestClose: () => void
}) {
  const sheet = useMobileRouteSheet({ layout: 'sheet', onRequestClose })
  return (
    <NewAppointmentSheetSurface
      appointmentDate={appointmentDate}
      mode={mode}
      presentation="mobile"
      sheet={sheet}
    />
  )
}

function DesktopNewAppointmentSheetDialog({
  appointmentDate,
  mode,
  onRequestClose
}: {
  readonly appointmentDate: string
  readonly mode: AppointmentCreateMode
  readonly onRequestClose: () => void
}) {
  const sheet = useDesktopAppointmentDialogSurface(onRequestClose)
  return (
    <NewAppointmentSheetSurface
      appointmentDate={appointmentDate}
      mode={mode}
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
  mode,
  presentation,
  sheet
}: {
  readonly appointmentDate: string
  readonly mode: AppointmentCreateMode
  readonly presentation: NewAppointmentPresentation
  readonly sheet: NewAppointmentSheetController
}) {
  const sheetRef = sheet.sheetRef
  const [notifyCustomer, setNotifyCustomer] = useState(mode !== 'record-completed')
  const [customerLocale, setCustomerLocale] = useState<'ro' | 'en'>('en')
  const [step, setStep] = useState<NewAppointmentStep>('appointment')
  const [desktopSubstepState, setDesktopSubstepState] = useState<
    'preparing' | 'entering' | 'open' | 'closing'
  >('open')
  const [desktopSubstepRouteMotion, setDesktopSubstepRouteMotion] = useState(false)
  const [selectedClient, setSelectedClient] = useState<AppointmentClient | null>(null)
  const [selectedService, setSelectedService] = useState<ServiceRecord | null>(null)
  const [durationMinutes, setDurationMinutes] = useState(0)
  const [selectedDate, setSelectedDate] = useState(() => {
    const requestedDate = decodeCalendarDate(appointmentDate)
    return mode === 'record-completed'
      ? requestedDate
      : latestCalendarDate(requestedDate, browserCalendarToday())
  })
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [repeatEveryWeeks, setRepeatEveryWeeks] = useState<number | null>(
    mode === 'series' ? 1 : null
  )
  const [recordedLocalTime, setRecordedLocalTime] = useState('12:00')
  const [completionReason, setCompletionReason] = useState('')
  const [completionCollectionKind, setCompletionCollectionKind] = useState<
    'collected' | 'already_recorded' | 'collect_later'
  >('collect_later')
  const [completionAmount, setCompletionAmount] = useState('')
  const [completionMethod, setCompletionMethod] = useState<
    'cash' | 'card_terminal' | 'bank_transfer' | 'other'
  >('cash')
  const [historicalOverlapAcknowledged, setHistoricalOverlapAcknowledged] =
    useState(false)
  const [repeatCount, setRepeatCount] = useState(4)
  const [excludedSeriesIndices, setExcludedSeriesIndices] = useState<number[]>([])
  const [seriesDateOverrides, setSeriesDateOverrides] = useState<
    Readonly<Record<number, string>>
  >({})
  const [seriesFoldChoices, setSeriesFoldChoices] = useState<
    Readonly<Record<number, 0 | 1>>
  >({})
  const excludedSeriesIndexSet = new Set(excludedSeriesIndices)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [saveError, setSaveError] = useState('')
  const [seriesPreview, setSeriesPreview] = useState<
    Readonly<Record<number, 'available' | 'warning' | 'conflict'>>
  >({})
  const [seriesPreviewKey, setSeriesPreviewKey] = useState('')
  const [seriesWarningsAcknowledged, setSeriesWarningsAcknowledged] = useState(false)
  const [seriesOverrideReason, setSeriesOverrideReason] = useState('')
  const [recurrencePickerOpen, setRecurrencePickerOpen] = useState(false)
  const [appointmentNote, setAppointmentNote] = useState('')
  const [clientNote, setClientNote] = useState('')
  const [customerDirectory, setCustomerDirectory] =
    useState<CustomerDirectoryView | null>(null)
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
  const appointmentContentRef = useRef<HTMLDivElement>(null)
  const stepContentRef = useRef<HTMLDivElement>(null)
  const desktopSubstepRef = useRef<HTMLDialogElement>(null)
  const stepOriginFocusRef = useRef<HTMLElement | null>(null)
  const stepOriginFieldRef = useRef<string | null>(null)
  const desktopSubstepFrameRef = useRef<number | null>(null)
  const desktopSubstepTimerRef = useRef<number | null>(null)

  const checkSeriesPreview = async () => {
    if (!selectedService || !availability || !effectiveSelectedTime) return
    setSaveError('')
    try {
      const previewKey = currentSeriesDraftKey()
      if (previewKey !== seriesPreviewKey) {
        setSeriesWarningsAcknowledged(false)
        setSeriesOverrideReason('')
      }
      const localTime = appointmentTimes(availability, selectedDate).find(
        (time) => time.instant === effectiveSelectedTime
      )?.value
      if (!localTime) return
      const occurrences = Array.from(
        { length: repeatCount },
        (_, index) => index
      ).flatMap((index) => {
        if (excludedSeriesIndexSet.has(index)) return []
        const date =
          seriesDateOverrides[index] ??
          addDraftCalendarDays(selectedDate, index * (repeatEveryWeeks ?? 1) * 7)
        const candidates = civilTimeInstants(date, localTime, availability.timezone)
        const startsAt = candidates[seriesFoldChoices[index] ?? 0]?.toISOString()
        if (!startsAt)
          throw new Error(`Resolve the local time for occurrence ${index + 1}.`)
        return {
          cadencePosition: index,
          startsAt,
          endsAt: new Date(
            Date.parse(startsAt) + durationMinutes * 60_000
          ).toISOString()
        }
      })
      const result = await previewAppointmentSeries({
        data: { serviceIds: [selectedService.id], occurrences }
      })
      setSeriesPreview(
        Object.fromEntries(result.map((entry) => [entry.cadencePosition, entry.status]))
      )
      setSeriesPreviewKey(previewKey)
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Series preview could not be checked.'
      )
    }
  }

  const saveAppointment = async () => {
    if (!selectedClient || !selectedService || !effectiveSelectedTime || !availability)
      return
    setSaveState('saving')
    setSaveError('')
    const localTime = appointmentTimes(availability, selectedDate).find(
      (time) => time.instant === effectiveSelectedTime
    )?.value
    try {
      if (repeatEveryWeeks && localTime) {
        if (seriesPreviewKey !== currentSeriesDraftKey())
          throw new Error('Check the finalized Series before saving it.')
        const occurrences = Array.from(
          { length: repeatCount },
          (_, index) => index
        ).flatMap((index) => {
          if (excludedSeriesIndexSet.has(index)) return []
          const date =
            seriesDateOverrides[index] ??
            addDraftCalendarDays(selectedDate, index * repeatEveryWeeks * 7)
          const candidates = civilTimeInstants(date, localTime, availability.timezone)
          if (candidates.length === 0)
            throw new Error(
              `${date} ${localTime} does not exist because of a timezone change. Adjust or exclude that occurrence.`
            )
          if (candidates.length > 1 && seriesFoldChoices[index] === undefined)
            throw new Error(
              `${date} ${localTime} is ambiguous. Choose the earlier or later instant in the preview.`
            )
          const startsAt = candidates[seriesFoldChoices[index] ?? 0]!.toISOString()
          return {
            cadencePosition: index,
            ...(seriesDateOverrides[index] ? { adjusted: true } : {}),
            startsAt,
            endsAt: new Date(
              Date.parse(startsAt) + durationMinutes * 60_000
            ).toISOString()
          }
        })
        if (occurrences.length < 2)
          throw new Error('A series requires at least two included Appointments.')
        await runAppointmentCommand({
          data: {
            kind: 'create_series',
            idempotencyKey: crypto.randomUUID(),
            intervalWeeks: repeatEveryWeeks,
            localStartDate: selectedDate,
            localStartTime: localTime,
            occurrences,
            serviceIds: [selectedService.id],
            ...(selectedClient.source === 'directory'
              ? { customerRecordId: selectedClient.id }
              : {}),
            customer: {
              name: selectedClient.name,
              email: selectedClient.email || null,
              phone: selectedClient.phone,
              ...(clientNote ? { note: clientNote } : {})
            },
            ...(seriesWarningsAcknowledged
              ? {
                  warningAcknowledged: true,
                  ...(seriesOverrideReason.trim()
                    ? { overrideReason: seriesOverrideReason }
                    : {})
                }
              : {}),
            ...(mode === 'record-completed'
              ? {}
              : {
                  notification: notifyCustomer
                    ? ({ kind: 'notify', locale: customerLocale } as const)
                    : ({
                        kind: 'suppress',
                        reason: 'Customer already knows.',
                        locale: customerLocale
                      } as const)
                })
          }
        })
      } else {
        await runAppointmentCommand({
          data: {
            kind: mode === 'record-completed' ? 'record_completed' : 'create',
            idempotencyKey: crypto.randomUUID(),
            startsAt: effectiveSelectedTime,
            endsAt: new Date(
              Date.parse(effectiveSelectedTime) + durationMinutes * 60_000
            ).toISOString(),
            serviceIds: [selectedService.id],
            ...(selectedClient.source === 'directory'
              ? { customerRecordId: selectedClient.id }
              : {}),
            customer: {
              name: selectedClient.name,
              email: selectedClient.email || null,
              phone: selectedClient.phone,
              ...(clientNote ? { note: clientNote } : {})
            },
            ...(appointmentNote ? { appointmentNote } : {}),
            ...(mode === 'record-completed'
              ? {
                  completionReason,
                  warningAcknowledged: historicalOverlapAcknowledged,
                  completionCollection:
                    completionCollectionKind === 'collected'
                      ? {
                          kind: 'collected' as const,
                          amountMinor: Math.round(Number(completionAmount) * 100),
                          method: completionMethod,
                          recordedAt: new Date().toISOString()
                        }
                      : { kind: completionCollectionKind }
                }
              : {}),
            notification: notifyCustomer
              ? { kind: 'notify', locale: customerLocale }
              : {
                  kind: 'suppress',
                  reason: 'Customer already knows.',
                  locale: customerLocale
                }
          }
        })
      }
      sheet.closeSheet()
      window.location.reload()
    } catch (error) {
      setSaveState('failed')
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : 'Appointment could not be saved. Review the latest schedule and retry.'
      )
    }
  }

  const clearDesktopSubstepLifecycle = useCallback(() => {
    if (desktopSubstepFrameRef.current) {
      window.cancelAnimationFrame(desktopSubstepFrameRef.current)
      desktopSubstepFrameRef.current = null
    }
    if (desktopSubstepTimerRef.current) {
      window.clearTimeout(desktopSubstepTimerRef.current)
      desktopSubstepTimerRef.current = null
    }
  }, [])

  const openStep = (
    nextStep: Exclude<NewAppointmentStep, 'appointment'>,
    originField?: string
  ) => {
    if (step === 'appointment' && document.activeElement instanceof HTMLElement) {
      stepOriginFocusRef.current = document.activeElement
      stepOriginFieldRef.current = originField ?? null
    }
    clearDesktopSubstepLifecycle()
    if (presentation === 'desktop') {
      const routeWithinSidecar = step !== 'appointment'
      setDesktopSubstepRouteMotion(routeWithinSidecar)
      setDesktopSubstepState(
        routeWithinSidecar || desktopMotionReduced() ? 'open' : 'preparing'
      )
    }
    setStep(nextStep)
  }

  const returnToAppointment = () => {
    if (presentation !== 'desktop' || step === 'appointment') {
      setStep('appointment')
      return
    }
    clearDesktopSubstepLifecycle()
    setDesktopSubstepRouteMotion(false)
    if (desktopMotionReduced()) {
      setStep('appointment')
      setDesktopSubstepState('open')
      return
    }
    setDesktopSubstepState('closing')
  }

  const finishDesktopSubstepAnimation = useCallback(
    (state: 'preparing' | 'entering' | 'open' | 'closing') => {
      if (state === 'entering') {
        clearDesktopSubstepLifecycle()
        setDesktopSubstepState('open')
        return
      }
      if (state !== 'closing') return
      clearDesktopSubstepLifecycle()
      setStep('appointment')
      setDesktopSubstepState('open')
    },
    [clearDesktopSubstepLifecycle]
  )

  useEffect(() => {
    if (
      presentation !== 'desktop' ||
      step === 'appointment' ||
      desktopSubstepState !== 'preparing'
    )
      return
    desktopSubstepFrameRef.current = window.requestAnimationFrame(() => {
      desktopSubstepFrameRef.current = null
      setDesktopSubstepState('entering')
    })
    return () => {
      if (!desktopSubstepFrameRef.current) return
      window.cancelAnimationFrame(desktopSubstepFrameRef.current)
      desktopSubstepFrameRef.current = null
    }
  }, [desktopSubstepState, presentation, step])

  useEffect(() => {
    if (
      presentation !== 'desktop' ||
      (desktopSubstepState !== 'entering' && desktopSubstepState !== 'closing')
    )
      return
    desktopSubstepTimerRef.current = window.setTimeout(
      () => finishDesktopSubstepAnimation(desktopSubstepState),
      500
    )
    return () => {
      if (!desktopSubstepTimerRef.current) return
      window.clearTimeout(desktopSubstepTimerRef.current)
      desktopSubstepTimerRef.current = null
    }
  }, [desktopSubstepState, finishDesktopSubstepAnimation, presentation])

  useLayoutEffect(() => {
    if (presentation !== 'desktop') return
    if (step === 'appointment') {
      const origin = stepOriginFocusRef.current
      stepOriginFocusRef.current = null
      const field =
        stepOriginFieldRef.current ?? origin?.dataset.mobileNewAppointmentField
      stepOriginFieldRef.current = null
      const restoredOrigin = field
        ? appointmentContentRef.current?.querySelector<HTMLElement>(
            `[data-mobile-new-appointment-field="${field}"]`
          )
        : origin
      if (restoredOrigin?.isConnected) restoredOrigin.focus({ preventScroll: true })
      return
    }
    if (desktopSubstepState !== 'open') return
    desktopSubstepRef.current?.focus({ preventScroll: true })
  }, [desktopSubstepState, presentation, step])

  useEffect(() => {
    componentMounted.current = true
    return () => {
      componentMounted.current = false
      clearDesktopSubstepLifecycle()
    }
  }, [clearDesktopSubstepLifecycle])

  useEffect(() => {
    if (
      step !== 'clients' ||
      customerDirectoryRequestStarted.current ||
      customerDirectory
    )
      return
    customerDirectoryRequestStarted.current = true
    setCustomerDirectoryState('loading')
    void searchCustomerRecords({ data: { query: '' } })
      .then((records) => {
        if (!componentMounted.current) return
        setCustomerDirectory({ entries: records })
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
        const merchantToday = calendarDateAtTimezone(
          new Date(Date.now()).toISOString(),
          result.timezone
        )
        if (mode !== 'record-completed' && selectedDate < merchantToday) {
          setSelectedDate(merchantToday)
          setSelectedTime(null)
        }
      })
      .catch(() => {
        if (!active) return
        setAvailability(null)
        setAvailabilityState('error')
      })
    return () => {
      active = false
    }
  }, [catalog, durationMinutes, mode, selectedDate, selectedService])

  const effectiveSelectedTime = (() => {
    if (mode !== 'record-completed' || !availability) return selectedTime
    const candidates = civilTimeInstants(
      selectedDate,
      recordedLocalTime,
      availability.timezone
    )
    return candidates.length === 1 ? candidates[0]!.toISOString() : null
  })()

  function currentSeriesDraftKey() {
    return JSON.stringify({
      serviceId: selectedService?.id ?? null,
      durationMinutes,
      selectedDate,
      selectedTime: effectiveSelectedTime,
      repeatEveryWeeks,
      repeatCount,
      excludedSeriesIndices: [...excludedSeriesIndices].sort(
        (left, right) => left - right
      ),
      seriesDateOverrides,
      seriesFoldChoices
    })
  }

  const seriesPreviewCurrent = seriesPreviewKey === currentSeriesDraftKey()

  const activateDialog = useNewAppointmentDialogActivation(sheetRef, presentation)
  const activateDesktopSubstepDialog = useNewAppointmentDialogActivation(
    desktopSubstepRef,
    'desktop',
    false
  )
  const desktop = presentation === 'desktop'
  const appointmentDraft = (
    <AppointmentDraft
      presentation={presentation}
      notifyCustomer={notifyCustomer}
      customerLocale={customerLocale}
      selectedClient={selectedClient}
      selectedService={selectedService}
      durationMinutes={durationMinutes}
      selectedDate={selectedDate}
      selectedTime={effectiveSelectedTime}
      repeatEveryWeeks={repeatEveryWeeks}
      repeatCount={repeatCount}
      excludedSeriesIndices={excludedSeriesIndices}
      seriesDateOverrides={seriesDateOverrides}
      seriesFoldChoices={seriesFoldChoices}
      seriesPreview={seriesPreviewCurrent ? seriesPreview : {}}
      seriesWarningsAcknowledged={seriesPreviewCurrent && seriesWarningsAcknowledged}
      seriesOverrideReason={seriesOverrideReason}
      appointmentNote={appointmentNote}
      clientNote={clientNote}
      availability={availability}
      availabilityState={availabilityState}
      mode={mode}
      recordedLocalTime={recordedLocalTime}
      completionReason={completionReason}
      completionCollectionKind={completionCollectionKind}
      completionAmount={completionAmount}
      completionMethod={completionMethod}
      historicalOverlapAcknowledged={historicalOverlapAcknowledged}
      saveState={saveState}
      saveError={saveError}
      onClose={() => sheet.closeSheet()}
      onChooseClient={() => openStep('clients', 'client')}
      onChooseService={() => openStep('services', 'service')}
      onChangeDuration={(change) => {
        setDurationMinutes((current) => Math.max(15, current + change))
        setSelectedTime(null)
      }}
      onSelectDate={(date) => {
        if (mode !== 'record-completed' && date < minimumBookableDate(availability))
          return
        setSelectedDate(date)
        setSelectedTime(null)
      }}
      onSelectTime={setSelectedTime}
      onChangeRecordedLocalTime={(time) => {
        setRecordedLocalTime(time)
      }}
      onChangeCompletionReason={setCompletionReason}
      onChangeCompletionCollectionKind={setCompletionCollectionKind}
      onChangeCompletionAmount={setCompletionAmount}
      onChangeCompletionMethod={setCompletionMethod}
      onToggleHistoricalOverlapAcknowledgement={() =>
        setHistoricalOverlapAcknowledged((current) => !current)
      }
      onChooseRepeat={() => {
        if (presentation === 'desktop') openStep('recurrence', 'repeat')
        else setRecurrencePickerOpen(true)
      }}
      onChangeRepeatCount={(count) => {
        setRepeatCount(count)
        setExcludedSeriesIndices((current) => current.filter((index) => index < count))
      }}
      onToggleSeriesOccurrence={(index) =>
        setExcludedSeriesIndices((current) =>
          current.includes(index)
            ? current.filter((candidate) => candidate !== index)
            : [...current, index]
        )
      }
      onChangeSeriesOccurrenceDate={(index, date) =>
        setSeriesDateOverrides((current) => ({ ...current, [index]: date }))
      }
      onChooseSeriesFold={(index, choice) =>
        setSeriesFoldChoices((current) => ({ ...current, [index]: choice }))
      }
      onCheckSeriesPreview={() => void checkSeriesPreview()}
      onToggleSeriesWarningsAcknowledgement={() =>
        setSeriesWarningsAcknowledged((current) => !current)
      }
      onChangeSeriesOverrideReason={setSeriesOverrideReason}
      onEditAppointmentNote={() => openStep('appointment-notes', 'appointment-notes')}
      onEditClientNote={() => openStep('client-notes', 'client-notes')}
      onToggleNotify={() => setNotifyCustomer((current) => !current)}
      onChangeCustomerLocale={setCustomerLocale}
      onSave={() => void saveAppointment()}
    />
  )

  const renderSubstep = () => {
    if (step === 'clients')
      return (
        <MobileAppointmentClientPicker
          directory={customerDirectory}
          loading={customerDirectoryState === 'loading'}
          error={customerDirectoryState === 'error'}
          selectedClient={selectedClient}
          desktop={desktop}
          onBack={returnToAppointment}
          onAddClient={() => openStep('add-client')}
          onConfirm={(client) => {
            if (client.id !== selectedClient?.id) setClientNote('')
            setSelectedClient(client)
            returnToAppointment()
          }}
        />
      )
    if (step === 'add-client')
      return (
        <MobileAppointmentAddClient
          desktop={desktop}
          onBack={() => openStep('clients')}
          onSave={(client) => {
            setSelectedClient(client)
            setClientNote(client.draftProfile?.notes ?? '')
            returnToAppointment()
          }}
        />
      )
    if (step === 'appointment-notes')
      return (
        <MobileAppointmentNotesEditor
          kind="appointment"
          note={appointmentNote}
          presentation={presentation}
          onClose={returnToAppointment}
          onSave={(note) => {
            setAppointmentNote(note)
            returnToAppointment()
          }}
        />
      )
    if (step === 'client-notes')
      return (
        <MobileAppointmentNotesEditor
          kind="client"
          note={clientNote}
          presentation={presentation}
          onClose={returnToAppointment}
          onSave={(note) => {
            setClientNote(note)
            returnToAppointment()
          }}
        />
      )
    if (step === 'recurrence')
      return (
        <AppointmentRecurrencePicker
          presentation="desktop"
          selectedWeeks={repeatEveryWeeks}
          onClose={returnToAppointment}
          onConfirm={(weeks) => {
            setRepeatEveryWeeks(weeks)
            returnToAppointment()
          }}
        />
      )
    if (step === 'services')
      return (
        <MobileAppointmentServicePicker
          services={
            catalog?.services.filter(
              (service) =>
                service.status === 'active' && service.eligibleProviderIds.length > 0
            ) ?? []
          }
          loading={catalogState === 'loading'}
          error={catalogState === 'error'}
          selectedService={selectedService}
          desktop={desktop}
          onBack={returnToAppointment}
          onConfirm={(service) => {
            setSelectedService(service)
            setDurationMinutes(service.durationMinutes)
            setSelectedTime(null)
            returnToAppointment()
          }}
        />
      )
    return null
  }

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
        data-new-appointment-step={desktop ? 'appointment' : undefined}
        data-desktop-substep-open={desktop ? step !== 'appointment' : undefined}
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
          <MobileSheetDragHandle
            label="Drag or tap to close new appointment"
            onClick={sheet.handleCloseClick}
            onPointerDown={sheet.handlePointerDown}
            onPointerMove={sheet.handlePointerMove}
            onPointerUp={sheet.handlePointerUp}
            onPointerCancel={sheet.handlePointerCancel}
          />
        )}

        <div
          ref={desktop ? appointmentContentRef : stepContentRef}
          data-new-appointment-step={desktop ? 'appointment' : step}
          className="contents"
        >
          {desktop || step === 'appointment' ? appointmentDraft : renderSubstep()}
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

      {desktop && step !== 'appointment' ? (
        <dialog
          ref={activateDesktopSubstepDialog}
          aria-label={newAppointmentStepLabel(step)}
          aria-modal="true"
          tabIndex={-1}
          data-desktop-substep={step}
          data-desktop-substep-state={desktopSubstepState}
          data-new-appointment-presentation="desktop"
          inert={desktopSubstepState === 'open' ? undefined : true}
          className="merchant-desktop-new-appointment-sidecar merchant-route-sheet merchant-mobile-sheet-theme z-20 m-0 flex flex-col overflow-hidden border bg-background p-0 text-foreground outline-none"
          onCancel={(event) => {
            event.preventDefault()
            returnToAppointment()
          }}
          onClickCapture={(event) => {
            if (event.target !== event.currentTarget) return
            const bounds = event.currentTarget.getBoundingClientRect()
            const outside =
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            if (outside) returnToAppointment()
          }}
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return
            const state = event.currentTarget.dataset.desktopSubstepState
            if (state === 'entering' || state === 'closing')
              finishDesktopSubstepAnimation(state)
          }}
        >
          <div
            key={step}
            ref={stepContentRef}
            data-new-appointment-step={step}
            data-desktop-substep-route-motion={
              desktopSubstepRouteMotion ? 'true' : undefined
            }
            className="merchant-desktop-substep-route h-full min-h-0"
          >
            {renderSubstep()}
          </div>
        </dialog>
      ) : null}
    </div>
  )
}

function newAppointmentStepLabel(step: Exclude<NewAppointmentStep, 'appointment'>) {
  switch (step) {
    case 'clients':
      return 'Select a client'
    case 'add-client':
      return 'Add a new client'
    case 'services':
      return 'Select a service'
    case 'appointment-notes':
      return 'Notes for appointment'
    case 'client-notes':
      return 'Notes for client'
    case 'recurrence':
      return 'Set a frequency'
  }
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
  presentation: NewAppointmentPresentation,
  focusOnOpen = true
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
      if (focusOnOpen) dialog.focus({ preventScroll: true })
      return () => {
        if (dialog.open && typeof dialog.close === 'function') dialog.close()
        sheetRef.current = null
      }
    },
    [focusOnOpen, presentation, sheetRef]
  )
}

function AppointmentDraft({
  presentation,
  notifyCustomer,
  customerLocale,
  selectedClient,
  selectedService,
  durationMinutes,
  selectedDate,
  selectedTime,
  repeatEveryWeeks,
  repeatCount,
  excludedSeriesIndices,
  seriesDateOverrides,
  seriesFoldChoices,
  seriesPreview,
  seriesWarningsAcknowledged,
  seriesOverrideReason,
  appointmentNote,
  clientNote,
  availability,
  availabilityState,
  mode,
  recordedLocalTime,
  completionReason,
  completionCollectionKind,
  completionAmount,
  completionMethod,
  historicalOverlapAcknowledged,
  saveState,
  saveError,
  onClose,
  onChooseClient,
  onChooseService,
  onChangeDuration,
  onSelectDate,
  onSelectTime,
  onChangeRecordedLocalTime,
  onChangeCompletionReason,
  onChangeCompletionCollectionKind,
  onChangeCompletionAmount,
  onChangeCompletionMethod,
  onToggleHistoricalOverlapAcknowledgement,
  onChooseRepeat,
  onChangeRepeatCount,
  onToggleSeriesOccurrence,
  onChangeSeriesOccurrenceDate,
  onChooseSeriesFold,
  onCheckSeriesPreview,
  onToggleSeriesWarningsAcknowledgement,
  onChangeSeriesOverrideReason,
  onEditAppointmentNote,
  onEditClientNote,
  onToggleNotify,
  onChangeCustomerLocale,
  onSave
}: {
  readonly presentation: NewAppointmentPresentation
  readonly notifyCustomer: boolean
  readonly customerLocale: 'ro' | 'en'
  readonly selectedClient: AppointmentClient | null
  readonly selectedService: ServiceRecord | null
  readonly durationMinutes: number
  readonly selectedDate: string
  readonly selectedTime: string | null
  readonly repeatEveryWeeks: number | null
  readonly repeatCount: number
  readonly excludedSeriesIndices: readonly number[]
  readonly seriesDateOverrides: Readonly<Record<number, string>>
  readonly seriesFoldChoices: Readonly<Record<number, 0 | 1>>
  readonly seriesPreview: Readonly<Record<number, 'available' | 'warning' | 'conflict'>>
  readonly seriesWarningsAcknowledged: boolean
  readonly seriesOverrideReason: string
  readonly appointmentNote: string
  readonly clientNote: string
  readonly availability: Availability | null
  readonly availabilityState: 'idle' | 'loading' | 'ready' | 'error'
  readonly mode: AppointmentCreateMode
  readonly recordedLocalTime: string
  readonly completionReason: string
  readonly completionCollectionKind: 'collected' | 'already_recorded' | 'collect_later'
  readonly completionAmount: string
  readonly completionMethod: 'cash' | 'card_terminal' | 'bank_transfer' | 'other'
  readonly historicalOverlapAcknowledged: boolean
  readonly saveState: 'idle' | 'saving' | 'failed'
  readonly saveError: string
  readonly onClose: () => void
  readonly onChooseClient: () => void
  readonly onChooseService: () => void
  readonly onChangeDuration: (change: number) => void
  readonly onSelectDate: (date: string) => void
  readonly onSelectTime: (time: string) => void
  readonly onChangeRecordedLocalTime: (time: string) => void
  readonly onChangeCompletionReason: (reason: string) => void
  readonly onChangeCompletionCollectionKind: (
    kind: 'collected' | 'already_recorded' | 'collect_later'
  ) => void
  readonly onChangeCompletionAmount: (amount: string) => void
  readonly onChangeCompletionMethod: (
    method: 'cash' | 'card_terminal' | 'bank_transfer' | 'other'
  ) => void
  readonly onToggleHistoricalOverlapAcknowledgement: () => void
  readonly onChooseRepeat: () => void
  readonly onChangeRepeatCount: (count: number) => void
  readonly onToggleSeriesOccurrence: (index: number) => void
  readonly onChangeSeriesOccurrenceDate: (index: number, date: string) => void
  readonly onChooseSeriesFold: (index: number, choice: 0 | 1) => void
  readonly onCheckSeriesPreview: () => void
  readonly onToggleSeriesWarningsAcknowledgement: () => void
  readonly onChangeSeriesOverrideReason: (reason: string) => void
  readonly onEditAppointmentNote: () => void
  readonly onEditClientNote: () => void
  readonly onToggleNotify: () => void
  readonly onChangeCustomerLocale: (locale: 'ro' | 'en') => void
  readonly onSave: () => void
}) {
  const {
    collapsed: compactHeader,
    handleScroll: handleTitleScroll,
    largeTitleRef
  } = useMobileCollapsingSheetTitle()
  const canSave = Boolean(
    selectedClient &&
    selectedService &&
    selectedTime &&
    (mode !== 'record-completed' ||
      (completionReason.trim() &&
        historicalOverlapAcknowledged &&
        (completionCollectionKind !== 'collected' || Number(completionAmount) > 0))) &&
    (!repeatEveryWeeks ||
      (repeatCount - excludedSeriesIndices.length >= 2 &&
        !Object.values(seriesPreview).includes('conflict') &&
        (!Object.values(seriesPreview).includes('warning') ||
          seriesWarningsAcknowledged)))
  )
  const excludedSeriesIndexSet = new Set(excludedSeriesIndices)
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
            {appointmentComposerTitle(mode)}
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
        <MobileSheetHeader
          title={appointmentComposerTitle(mode)}
          titleAs="p"
          titleVisible={compactHeader}
          divider={compactHeader}
          headerDataAttribute="data-mobile-new-appointment-compact-header"
          titleDataAttribute="data-mobile-new-appointment-compact-title"
          leading={
            <MobileSheetCloseButton label="Close new appointment" onClick={onClose} />
          }
        />
      )}

      <MobileSheetScrollport
        className={desktop ? 'px-8' : 'px-4'}
        onScroll={desktop ? undefined : handleTitleScroll}
      >
        <div
          className={
            desktop
              ? 'relative pt-2 pb-24'
              : 'relative pb-[max(8rem,calc(env(safe-area-inset-bottom)+6.5rem))]'
          }
        >
          {desktop ? null : (
            <header
              ref={largeTitleRef}
              aria-hidden={compactHeader}
              data-mobile-new-appointment-large-title="true"
              data-visible={compactHeader ? 'false' : 'true'}
              className={`pt-1 ${
                compactHeader ? 'invisible opacity-0' : 'visible opacity-100'
              }`}
            >
              <h1 className="mt-1 max-w-64 text-[2.35rem] leading-[1.05] font-bold tracking-[-0.035em]">
                {appointmentComposerTitle(mode)}
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
            mode === 'record-completed' ? (
              <RecordCompletedSchedulingSection
                selectedDate={selectedDate}
                selectedTime={recordedLocalTime}
                timezone={availability?.timezone}
                reason={completionReason}
                collectionKind={completionCollectionKind}
                collectionAmount={completionAmount}
                collectionMethod={completionMethod}
                overlapAcknowledged={historicalOverlapAcknowledged}
                onSelectDate={onSelectDate}
                onSelectTime={onChangeRecordedLocalTime}
                onChangeReason={onChangeCompletionReason}
                onChangeCollectionKind={onChangeCompletionCollectionKind}
                onChangeCollectionAmount={onChangeCompletionAmount}
                onChangeCollectionMethod={onChangeCompletionMethod}
                onToggleOverlapAcknowledgement={
                  onToggleHistoricalOverlapAcknowledgement
                }
              />
            ) : (
              <AppointmentSchedulingSection
                availability={availability}
                availabilityState={availabilityState}
                selectedDate={selectedDate}
                selectedTime={selectedTime}
                onSelectDate={onSelectDate}
                onSelectTime={onSelectTime}
              />
            )
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
            {mode === 'record-completed' ? null : (
              <AppointmentFieldRow
                icon={<Repeat2 />}
                label={appointmentRepeatLabel(repeatEveryWeeks)}
                field="repeat"
                tone="action"
                onClick={onChooseRepeat}
              />
            )}
            {repeatEveryWeeks ? (
              <div className="py-3">
                <label className="flex min-h-12 items-center gap-4">
                  <CalendarDays
                    aria-hidden
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 text-[1.0625rem] font-medium">
                    Appointments in series
                  </span>
                  <input
                    type="number"
                    aria-label="Appointments in series"
                    min={2}
                    max={52}
                    value={repeatCount}
                    onChange={(event) =>
                      onChangeRepeatCount(
                        Math.max(2, Math.min(52, Number(event.target.value) || 2))
                      )
                    }
                    className="h-10 w-20 rounded-lg border bg-background px-3 text-right font-semibold tabular-nums"
                  />
                </label>
                <ol
                  aria-label="Series occurrence preview"
                  className="mt-2 ml-9 grid max-h-40 gap-1 overflow-auto text-sm text-muted-foreground"
                >
                  {Array.from({ length: repeatCount }, (_, index) => {
                    const date =
                      seriesDateOverrides[index] ??
                      addDraftCalendarDays(selectedDate, index * repeatEveryWeeks * 7)
                    const localTime = appointmentTimes(availability, selectedDate).find(
                      (time) => time.instant === selectedTime
                    )?.value
                    const candidates =
                      availability && localTime
                        ? civilTimeInstants(date, localTime, availability.timezone)
                        : []
                    const excluded = excludedSeriesIndexSet.has(index)
                    const previewStatus = seriesPreview[index]
                    return (
                      <li
                        key={index}
                        className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg border p-2"
                      >
                        <span className={excluded ? 'line-through opacity-60' : ''}>
                          {index + 1}. {formatDraftDate(date)}
                          {previewStatus ? ` · ${previewStatus}` : ''}
                        </span>
                        <button
                          type="button"
                          className="text-xs font-semibold text-info"
                          onClick={() => onToggleSeriesOccurrence(index)}
                        >
                          {excluded ? 'Include' : 'Exclude'}
                        </button>
                        {excluded ? null : (
                          <input
                            type="date"
                            aria-label={`Series occurrence ${index + 1} date`}
                            value={date}
                            onChange={(event) =>
                              onChangeSeriesOccurrenceDate(index, event.target.value)
                            }
                            className="h-9 rounded-lg border bg-background px-2"
                          />
                        )}
                        {!excluded && candidates.length === 2 ? (
                          <select
                            aria-label={`Series occurrence ${index + 1} ambiguous time`}
                            value={seriesFoldChoices[index] ?? ''}
                            onChange={(event) =>
                              onChooseSeriesFold(
                                index,
                                Number(event.target.value) as 0 | 1
                              )
                            }
                            className="h-9 rounded-lg border bg-background px-2"
                          >
                            <option value="">Resolve time…</option>
                            <option value="0">Earlier instant</option>
                            <option value="1">Later instant</option>
                          </select>
                        ) : null}
                        {!excluded && localTime && candidates.length === 0 ? (
                          <span className="col-span-2 text-xs text-destructive">
                            This local time does not exist. Adjust the date or exclude
                            it.
                          </span>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
                <button
                  type="button"
                  className="mt-3 ml-9 rounded-lg border px-3 py-2 text-sm font-semibold"
                  onClick={onCheckSeriesPreview}
                >
                  Check warnings and conflicts
                </button>
                {Object.values(seriesPreview).includes('warning') ? (
                  <div className="mt-3 ml-9 grid gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={seriesWarningsAcknowledged}
                        onChange={onToggleSeriesWarningsAcknowledgement}
                      />
                      Acknowledge all warned occurrences
                    </label>
                    {seriesWarningsAcknowledged ? (
                      <input
                        aria-label="Series override reason"
                        value={seriesOverrideReason}
                        onChange={(event) =>
                          onChangeSeriesOverrideReason(event.target.value)
                        }
                        placeholder="Optional shared private reason"
                        className="h-9 rounded-lg border bg-background px-2"
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {mode === 'record-completed' ? null : (
            <>
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
                  {notifyCustomer ? (
                    <Check className="size-6" strokeWidth={2.2} />
                  ) : null}
                </span>
              </button>
              <label className="grid gap-1 border-b border-border/70 py-3 text-sm">
                Customer email language
                <select
                  aria-label="Customer email language"
                  className="h-10 rounded-lg border bg-background px-3"
                  value={customerLocale}
                  onChange={(event) =>
                    onChangeCustomerLocale(event.target.value as 'ro' | 'en')
                  }
                >
                  <option value="en">English</option>
                  <option value="ro">Română</option>
                </select>
              </label>
            </>
          )}
        </div>
      </MobileSheetScrollport>

      {saveError ? (
        <p
          role="alert"
          className="absolute inset-x-4 bottom-24 z-30 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {saveError}
        </p>
      ) : null}

      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-background from-55% via-background/95 to-transparent pt-10 ${
          desktop ? 'px-8 pb-6' : 'px-4 pb-[max(1rem,env(safe-area-inset-bottom))]'
        }`}
      >
        <button
          type="button"
          disabled={!canSave || saveState === 'saving'}
          aria-disabled={!canSave || saveState === 'saving'}
          data-mobile-new-appointment-save-state={
            saveState === 'saving' ? 'saving' : canSave ? 'ready' : 'incomplete'
          }
          data-mobile-new-appointment-save="true"
          onClick={onSave}
          className="pointer-events-auto flex h-14 w-full items-center justify-center rounded-xl bg-info text-[1.0625rem] font-semibold text-info-foreground transition-[opacity,transform] active:scale-[0.99] disabled:bg-muted disabled:text-muted-foreground disabled:opacity-65"
        >
          {saveState === 'saving'
            ? 'Saving…'
            : repeatEveryWeeks
              ? `Save ${repeatCount} appointments`
              : mode === 'record-completed'
                ? 'Record completed visit'
                : 'Save appointment'}
        </button>
      </div>
    </div>
  )
}

function MobileAppointmentNotesEditor({
  kind,
  note,
  presentation,
  onClose,
  onSave
}: {
  readonly kind: 'appointment' | 'client'
  readonly note: string
  readonly presentation: NewAppointmentPresentation
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
          aria-label={
            presentation === 'desktop'
              ? `Back from ${kind} notes`
              : `Close ${kind} notes`
          }
          onClick={onClose}
          className="grid size-12 place-items-center rounded-full text-muted-foreground transition-colors active:bg-muted active:text-foreground"
        >
          {presentation === 'desktop' ? (
            <ChevronLeft aria-hidden className="size-6" strokeWidth={2} />
          ) : (
            <X aria-hidden className="size-7" strokeWidth={1.6} />
          )}
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
            aria-label="Back from recurrence picker"
            onClick={onClose}
            className="grid size-8 place-items-center justify-self-end rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="size-5" strokeWidth={2} />
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

function appointmentComposerTitle(mode: AppointmentCreateMode) {
  if (mode === 'series') return 'Book an appointment series'
  if (mode === 'record-completed') return 'Record a completed visit'
  return 'Book an appointment'
}

function RecordCompletedSchedulingSection({
  selectedDate,
  selectedTime,
  timezone,
  reason,
  collectionKind,
  collectionAmount,
  collectionMethod,
  overlapAcknowledged,
  onSelectDate,
  onSelectTime,
  onChangeReason,
  onChangeCollectionKind,
  onChangeCollectionAmount,
  onChangeCollectionMethod,
  onToggleOverlapAcknowledgement
}: {
  readonly selectedDate: string
  readonly selectedTime: string
  readonly timezone: string | undefined
  readonly reason: string
  readonly collectionKind: 'collected' | 'already_recorded' | 'collect_later'
  readonly collectionAmount: string
  readonly collectionMethod: 'cash' | 'card_terminal' | 'bank_transfer' | 'other'
  readonly overlapAcknowledged: boolean
  readonly onSelectDate: (date: string) => void
  readonly onSelectTime: (time: string) => void
  readonly onChangeReason: (reason: string) => void
  readonly onChangeCollectionKind: (
    kind: 'collected' | 'already_recorded' | 'collect_later'
  ) => void
  readonly onChangeCollectionAmount: (amount: string) => void
  readonly onChangeCollectionMethod: (
    method: 'cash' | 'card_terminal' | 'bank_transfer' | 'other'
  ) => void
  readonly onToggleOverlapAcknowledgement: () => void
}) {
  return (
    <section className="grid gap-4 border-b border-border/70 py-5">
      <p className="text-sm text-muted-foreground">
        Record the actual past visit time. This creates a completed operational fact; it
        does not create a verified payment.
      </p>
      <label className="grid gap-1.5 text-sm font-medium">
        Visit date
        <input
          type="date"
          aria-label="Completed visit date"
          max={browserCalendarToday()}
          value={selectedDate}
          onChange={(event) => onSelectDate(event.target.value)}
          className="h-11 rounded-xl border bg-background px-3 text-base"
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Start time {timezone ? `(${timezone})` : ''}
        <input
          type="time"
          aria-label="Completed visit start time"
          value={selectedTime}
          onChange={(event) => onSelectTime(event.target.value)}
          className="h-11 rounded-xl border bg-background px-3 text-base"
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Completion reason
        <textarea
          aria-label="Completed visit reason"
          value={reason}
          onChange={(event) => onChangeReason(event.target.value)}
          className="min-h-20 rounded-xl border bg-background p-3 text-base"
          placeholder="Why is this visit being entered after completion?"
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        External Collection choice
        <select
          aria-label="Completed visit collection choice"
          value={collectionKind}
          onChange={(event) =>
            onChangeCollectionKind(
              event.target.value as 'collected' | 'already_recorded' | 'collect_later'
            )
          }
          className="h-11 rounded-xl border bg-background px-3 text-base"
        >
          <option value="collected">Record Collected now</option>
          <option value="already_recorded">Already recorded</option>
          <option value="collect_later">Collect later</option>
        </select>
      </label>
      {collectionKind === 'collected' ? (
        <div className="grid grid-cols-2 gap-2">
          <input
            aria-label="Completed visit collection amount"
            inputMode="decimal"
            value={collectionAmount}
            onChange={(event) => onChangeCollectionAmount(event.target.value)}
            placeholder="Amount"
            className="h-11 rounded-xl border bg-background px-3 text-base"
          />
          <select
            aria-label="Completed visit collection method"
            value={collectionMethod}
            onChange={(event) =>
              onChangeCollectionMethod(
                event.target.value as
                  | 'cash'
                  | 'card_terminal'
                  | 'bank_transfer'
                  | 'other'
              )
            }
            className="h-11 rounded-xl border bg-background px-3 text-base"
          >
            <option value="cash">Cash</option>
            <option value="card_terminal">Card terminal</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="other">Other</option>
          </select>
        </div>
      ) : null}
      <button
        type="button"
        aria-pressed={overlapAcknowledged}
        className="rounded-xl border p-3 text-left text-sm"
        onClick={onToggleOverlapAcknowledgement}
      >
        {overlapAcknowledged ? '✓ ' : ''}I reviewed the historical time. If it overlaps
        another Appointment, both facts remain visible and this visit reserves no time.
      </button>
      {!timezone ? (
        <p className="text-sm text-muted-foreground">Loading Shop timezone…</p>
      ) : null}
    </section>
  )
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
          className="mt-4 grid grid-cols-3 gap-2"
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

function addDraftCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
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
