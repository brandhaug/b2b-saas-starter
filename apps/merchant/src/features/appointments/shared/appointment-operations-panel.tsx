import { useEffect, useState } from 'react'
import type {
  MerchantAppointmentCommand,
  OperationalAppointment
} from '@b2b-saas-starter/capabilities/booking'
import { civilTimeInstants } from '@b2b-saas-starter/capabilities/scheduling'
import {
  getAppointmentHistory,
  runAppointmentCommand
} from '@/lib/server/appointment-operations.ts'
import { getMerchantCatalog } from '@/lib/server/merchant-catalog.ts'
import type { ServiceRecord } from '@b2b-saas-starter/capabilities/merchant-catalog'

export function AppointmentOperationsPanel({
  appointment
}: {
  readonly appointment: OperationalAppointment
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [customerName, setCustomerName] = useState(
    appointment.snapshot.customerDetails.name
  )
  const [customerEmail, setCustomerEmail] = useState(
    appointment.snapshot.customerDetails.email
  )
  const [customerPhone, setCustomerPhone] = useState(
    appointment.snapshot.customerDetails.phone ?? ''
  )
  const [rescheduleLocal, setRescheduleLocal] = useState(() =>
    localDateTimeValue(appointment.startsAt, appointment.snapshot.merchantTimezone)
  )
  const currentPrimaryService = appointment.snapshot.services.find(
    (service) => service.role === 'primary'
  )
  const [catalogServices, setCatalogServices] = useState<readonly ServiceRecord[]>([])
  const [rescheduleServiceId, setRescheduleServiceId] = useState(
    currentPrimaryService?.id ?? ''
  )
  const [rescheduleNotify, setRescheduleNotify] = useState(true)
  const [scheduleWarningAcknowledged, setScheduleWarningAcknowledged] = useState(false)
  const [scheduleOverrideReason, setScheduleOverrideReason] = useState('')
  const [cancellationCategory, setCancellationCategory] = useState<
    'customer_requested' | 'merchant_unavailable' | 'duplicate_or_error' | 'other'
  >('customer_requested')
  const [cancellationNote, setCancellationNote] = useState('')
  const [cancellationMessage, setCancellationMessage] = useState('')
  const [cancellationNotify, setCancellationNotify] = useState(true)
  const [returnOnCancellation, setReturnOnCancellation] = useState(false)
  const [collectionAmount, setCollectionAmount] = useState('')
  const [collectionKind, setCollectionKind] = useState<'collection' | 'return'>(
    'collection'
  )
  const [collectionMethod, setCollectionMethod] = useState<
    'cash' | 'card_terminal' | 'bank_transfer' | 'other'
  >('cash')
  const [collectionNote, setCollectionNote] = useState('')
  const [collectionOffsetId, setCollectionOffsetId] = useState('')
  const [collectionCorrectionReason, setCollectionCorrectionReason] = useState('')
  const [history, setHistory] = useState<
    Awaited<ReturnType<typeof getAppointmentHistory>>
  >([])
  useEffect(() => {
    let active = true
    getAppointmentHistory({ data: { appointmentId: appointment.id } })
      .then((entries) => {
        if (active) setHistory(entries)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [appointment.id])
  useEffect(() => {
    if (appointment.status !== 'scheduled') return
    let active = true
    getMerchantCatalog()
      .then((catalog) => {
        if (active)
          setCatalogServices(
            catalog.services.filter(
              (service) =>
                service.status === 'active' && service.eligibleProviderIds.length > 0
            )
          )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [appointment.status])
  const revision = appointment.revision ?? 1

  const execute = async (command: MerchantAppointmentCommand) => {
    setPending(true)
    setError('')
    try {
      await runAppointmentCommand({ data: command })
      window.location.reload()
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'The Appointment changed or the command is no longer valid. Reload and review the latest facts.'
      )
    } finally {
      setPending(false)
    }
  }

  const reschedule = () => {
    const [date, time] = rescheduleLocal.split('T')
    if (!date || !time) return
    const instants = civilTimeInstants(
      date,
      time,
      appointment.snapshot.merchantTimezone
    )
    if (instants.length !== 1) {
      setError(
        instants.length === 0
          ? 'That local time does not exist because of a timezone change.'
          : 'That local time is ambiguous. Choose another exact time.'
      )
      return
    }
    const startsAt = instants[0]!.toISOString()
    const replacementService = catalogServices.find(
      (service) => service.id === rescheduleServiceId
    )
    const durationMinutes =
      rescheduleServiceId !== currentPrimaryService?.id && replacementService
        ? replacementService.durationMinutes
        : appointment.snapshot.durationMinutes
    void execute({
      kind: 'reschedule',
      idempotencyKey: crypto.randomUUID(),
      appointmentId: appointment.id,
      expectedRevision: revision,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString(),
      ...(rescheduleServiceId !== currentPrimaryService?.id
        ? { serviceIds: [rescheduleServiceId] }
        : {}),
      ...(scheduleWarningAcknowledged
        ? {
            warningAcknowledged: true,
            ...(scheduleOverrideReason.trim()
              ? { overrideReason: scheduleOverrideReason }
              : {})
          }
        : {}),
      notification: rescheduleNotify
        ? { kind: 'notify' }
        : { kind: 'suppress', reason: 'Customer already knows.' }
    })
  }

  const cancellationFacts = () => ({
    category: cancellationCategory,
    ...(cancellationNote.trim() ? { privateNote: cancellationNote } : {}),
    ...(cancellationMessage.trim() ? { customerMessage: cancellationMessage } : {}),
    ...(returnOnCancellation && (appointment.externalCollectionNetMinor ?? 0) > 0
      ? {
          returnedAmounts: {
            [appointment.id]: appointment.externalCollectionNetMinor ?? 0
          }
        }
      : {}),
    notification: cancellationNotify
      ? ({ kind: 'notify' } as const)
      : ({ kind: 'suppress', reason: 'Customer already knows.' } as const)
  })

  return (
    <section aria-label="Appointment operations" className="mt-6 border bg-card p-5">
      <h2 className="font-semibold">Appointment operations</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Revision {revision}. Commands reload current facts instead of silently merging a
        stale view.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4">
        <fieldset disabled={pending} className="grid gap-2 rounded-xl border p-3">
          <legend className="px-1 text-sm font-medium">Customer details</legend>
          <input
            aria-label="Customer name"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            className="h-10 rounded-lg border bg-background px-3"
          />
          <input
            aria-label="Customer email"
            type="email"
            value={customerEmail}
            onChange={(event) => setCustomerEmail(event.target.value)}
            className="h-10 rounded-lg border bg-background px-3"
          />
          <input
            aria-label="Customer phone"
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
            className="h-10 rounded-lg border bg-background px-3"
          />
          <CommandButton
            onClick={() =>
              void execute({
                kind: 'edit',
                idempotencyKey: crypto.randomUUID(),
                appointmentId: appointment.id,
                expectedRevision: revision,
                customer: {
                  name: customerName,
                  email: customerEmail || null,
                  phone: customerPhone || null
                },
                notification: { kind: 'notify' }
              })
            }
          >
            Save customer details
          </CommandButton>
        </fieldset>

        {appointment.status === 'scheduled' ? (
          <fieldset disabled={pending} className="grid gap-2 rounded-xl border p-3">
            <legend className="px-1 text-sm font-medium">Schedule and outcome</legend>
            <input
              aria-label="New local appointment time"
              type="datetime-local"
              value={rescheduleLocal}
              onChange={(event) => setRescheduleLocal(event.target.value)}
              className="h-10 rounded-lg border bg-background px-3"
            />
            <select
              aria-label="Replacement service"
              value={rescheduleServiceId}
              onChange={(event) => setRescheduleServiceId(event.target.value)}
              className="h-10 rounded-lg border bg-background px-3"
            >
              {currentPrimaryService ? (
                <option value={currentPrimaryService.id}>
                  Keep {currentPrimaryService.name} —{' '}
                  {(appointment.snapshot.totalMinor / 100).toFixed(2)}{' '}
                  {appointment.snapshot.currency}
                </option>
              ) : null}
              {catalogServices
                .filter((service) => service.id !== currentPrimaryService?.id)
                .map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} — {(service.priceMinor / 100).toFixed(2)}{' '}
                    {service.currency}
                  </option>
                ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Current: {new Date(appointment.startsAt).toLocaleString()} ·{' '}
              {(appointment.snapshot.totalMinor / 100).toFixed(2)}{' '}
              {appointment.snapshot.currency}. Proposed time and any selected current
              Service will be revalidated atomically.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rescheduleNotify}
                onChange={(event) => setRescheduleNotify(event.target.checked)}
              />
              Notify customer about this revision
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scheduleWarningAcknowledged}
                onChange={(event) =>
                  setScheduleWarningAcknowledged(event.target.checked)
                }
              />
              Acknowledge outside-hours or Blocked Time warning if shown
            </label>
            {scheduleWarningAcknowledged ? (
              <input
                aria-label="Schedule override reason"
                value={scheduleOverrideReason}
                onChange={(event) => setScheduleOverrideReason(event.target.value)}
                placeholder="Optional private override reason"
                className="h-10 rounded-lg border bg-background px-3"
              />
            ) : null}
            <CommandButton onClick={reschedule}>Reschedule and notify</CommandButton>
            <div className="grid grid-cols-2 gap-2">
              <CommandButton
                onClick={() =>
                  void execute({
                    kind: 'complete',
                    idempotencyKey: crypto.randomUUID(),
                    appointmentId: appointment.id,
                    expectedRevision: revision,
                    ...(appointment.snapshot.totalMinor >
                    (appointment.externalCollectionNetMinor ?? 0)
                      ? {
                          collection: {
                            amountMinor:
                              appointment.snapshot.totalMinor -
                              (appointment.externalCollectionNetMinor ?? 0),
                            method: collectionMethod,
                            recordedAt: new Date().toISOString()
                          }
                        }
                      : {})
                  })
                }
              >
                Complete + collect full
              </CommandButton>
              <CommandButton
                onClick={() =>
                  void execute({
                    kind: 'no_show',
                    idempotencyKey: crypto.randomUUID(),
                    appointmentId: appointment.id,
                    expectedRevision: revision
                  })
                }
              >
                No Show
              </CommandButton>
            </div>
            <CommandButton
              onClick={() =>
                void execute({
                  kind: 'complete',
                  idempotencyKey: crypto.randomUUID(),
                  appointmentId: appointment.id,
                  expectedRevision: revision,
                  completionChoice: 'already_recorded'
                })
              }
            >
              Complete — already recorded
            </CommandButton>
            <CommandButton
              onClick={() =>
                void execute({
                  kind: 'complete',
                  idempotencyKey: crypto.randomUUID(),
                  appointmentId: appointment.id,
                  expectedRevision: revision,
                  completionChoice: 'collect_later'
                })
              }
            >
              Complete — collect later
            </CommandButton>
            <CommandButton
              destructive
              onClick={() =>
                void execute({
                  kind: 'cancel',
                  idempotencyKey: crypto.randomUUID(),
                  appointmentId: appointment.id,
                  expectedRevisions: { [appointment.id]: revision },
                  ...cancellationFacts()
                })
              }
            >
              Cancel Appointment
            </CommandButton>
          </fieldset>
        ) : null}

        {appointment.status === 'scheduled' ? (
          <fieldset disabled={pending} className="grid gap-2 rounded-xl border p-3">
            <legend className="px-1 text-sm font-medium">Cancellation facts</legend>
            <select
              aria-label="Cancellation category"
              value={cancellationCategory}
              onChange={(event) =>
                setCancellationCategory(
                  event.target.value as typeof cancellationCategory
                )
              }
              className="h-10 rounded-lg border bg-background px-3"
            >
              <option value="customer_requested">Customer requested</option>
              <option value="merchant_unavailable">Merchant unavailable</option>
              <option value="duplicate_or_error">Duplicate or error</option>
              <option value="other">Other</option>
            </select>
            <input
              aria-label="Private cancellation note"
              value={cancellationNote}
              onChange={(event) => setCancellationNote(event.target.value)}
              placeholder={
                cancellationCategory === 'other'
                  ? 'Private note (required)'
                  : 'Optional private note'
              }
              className="h-10 rounded-lg border bg-background px-3"
            />
            <input
              aria-label="Customer cancellation message"
              value={cancellationMessage}
              onChange={(event) => setCancellationMessage(event.target.value)}
              placeholder="Optional customer message"
              className="h-10 rounded-lg border bg-background px-3"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cancellationNotify}
                onChange={(event) => setCancellationNotify(event.target.checked)}
              />
              Notify customer
            </label>
            {(appointment.externalCollectionNetMinor ?? 0) > 0 ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={returnOnCancellation}
                  onChange={(event) => setReturnOnCancellation(event.target.checked)}
                />
                Value was actually returned; append a matching Returned fact
              </label>
            ) : null}
          </fieldset>
        ) : null}

        {appointment.status === 'completed' || appointment.status === 'no_show' ? (
          <CommandButton
            onClick={() =>
              void execute({
                kind: 'correct_outcome',
                idempotencyKey: crypto.randomUUID(),
                appointmentId: appointment.id,
                expectedRevision: revision,
                outcome: appointment.status === 'completed' ? 'no_show' : 'completed',
                reason: 'Owner corrected the recorded service outcome.'
              })
            }
          >
            Correct outcome to{' '}
            {appointment.status === 'completed' ? 'No Show' : 'Completed'}
          </CommandButton>
        ) : null}

        {appointment.seriesId &&
        appointment.seriesMembers?.some((member) => member.status === 'scheduled') ? (
          <CommandButton
            destructive
            onClick={() =>
              void execute({
                kind: 'cancel_remaining_series',
                idempotencyKey: crypto.randomUUID(),
                seriesId: appointment.seriesId!,
                expectedRevisions: Object.fromEntries(
                  appointment
                    .seriesMembers!.filter((member) => member.status === 'scheduled')
                    .map((member) => [member.id, member.revision])
                ),
                ...cancellationFacts()
              })
            }
          >
            Cancel remaining Series
          </CommandButton>
        ) : null}

        {appointment.bookingPartyId &&
        appointment.partyMembers?.some((member) => member.status === 'scheduled') ? (
          <CommandButton
            destructive
            onClick={() =>
              void execute({
                kind: 'cancel_party',
                idempotencyKey: crypto.randomUUID(),
                bookingPartyId: appointment.bookingPartyId!,
                expectedRevisions: Object.fromEntries(
                  appointment
                    .partyMembers!.filter((member) => member.status === 'scheduled')
                    .map((member) => [member.id, member.revision])
                ),
                ...cancellationFacts()
              })
            }
          >
            Cancel whole booking party
          </CommandButton>
        ) : null}

        <fieldset disabled={pending} className="grid gap-2 rounded-xl border p-3">
          <legend className="px-1 text-sm font-medium">External Collection</legend>
          <p className="text-xs text-muted-foreground">
            Operational fact only—not a verified Payment or revenue record. Net
            recorded: {((appointment.externalCollectionNetMinor ?? 0) / 100).toFixed(2)}{' '}
            {appointment.snapshot.currency}.
          </p>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              aria-label="External Collection amount"
              inputMode="decimal"
              value={collectionAmount}
              onChange={(event) => setCollectionAmount(event.target.value)}
              placeholder="0.00"
              className="h-10 rounded-lg border bg-background px-3"
            />
            <select
              aria-label="External Collection kind"
              value={collectionKind}
              onChange={(event) =>
                setCollectionKind(event.target.value as 'collection' | 'return')
              }
              className="h-10 rounded-lg border bg-background px-3"
            >
              <option value="collection">Collected</option>
              <option value="return">Returned</option>
            </select>
          </div>
          <select
            aria-label="External Collection method"
            value={collectionMethod}
            onChange={(event) =>
              setCollectionMethod(event.target.value as typeof collectionMethod)
            }
            className="h-10 rounded-lg border bg-background px-3"
          >
            <option value="cash">Cash</option>
            <option value="card_terminal">Card terminal</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="other">Other</option>
          </select>
          <input
            aria-label="External Collection note or reference"
            value={collectionNote}
            onChange={(event) => setCollectionNote(event.target.value)}
            placeholder="Optional note or reference"
            className="h-10 rounded-lg border bg-background px-3"
          />
          <input
            aria-label="External Collection offset entry"
            value={collectionOffsetId}
            onChange={(event) => setCollectionOffsetId(event.target.value)}
            placeholder="Original entry ID for a correction"
            className="h-10 rounded-lg border bg-background px-3"
          />
          {collectionOffsetId ? (
            <input
              aria-label="External Collection correction reason"
              value={collectionCorrectionReason}
              onChange={(event) => setCollectionCorrectionReason(event.target.value)}
              placeholder="Correction reason (required)"
              className="h-10 rounded-lg border bg-background px-3"
            />
          ) : null}
          <CommandButton
            onClick={() => {
              const amountMinor = Math.round(Number(collectionAmount) * 100)
              if (!Number.isInteger(amountMinor) || amountMinor <= 0)
                return setError('Enter a positive collection amount.')
              void execute({
                kind: 'append_collection',
                idempotencyKey: crypto.randomUUID(),
                appointmentId: appointment.id,
                expectedRevision: revision,
                entry: {
                  kind: collectionKind,
                  amountMinor,
                  method: collectionMethod,
                  recordedAt: new Date().toISOString(),
                  ...(collectionNote.trim() ? { noteOrReference: collectionNote } : {}),
                  ...(collectionOffsetId.trim()
                    ? {
                        offsetsEntryId: collectionOffsetId,
                        correctionReason: collectionCorrectionReason
                      }
                    : {})
                }
              })
            }}
          >
            Record {collectionKind === 'collection' ? 'Collected' : 'Returned'}
          </CommandButton>
        </fieldset>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">
          Immutable history ({history.length})
        </summary>
        <ol className="mt-2 grid gap-2 text-xs text-muted-foreground">
          {history.map((entry) => (
            <li
              key={`${entry.operationId}-${entry.resultingRevision}`}
              className="border-l-2 pl-3"
            >
              {entry.command} · revision {entry.priorRevision} →{' '}
              {entry.resultingRevision} · {new Date(entry.occurredAt).toLocaleString()}
            </li>
          ))}
        </ol>
      </details>
    </section>
  )
}

function CommandButton({
  children,
  onClick,
  destructive = false
}: {
  readonly children: React.ReactNode
  readonly onClick: () => void
  readonly destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${destructive ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'}`}
    >
      {children}
    </button>
  )
}

function localDateTimeValue(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(instant))
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`
}
