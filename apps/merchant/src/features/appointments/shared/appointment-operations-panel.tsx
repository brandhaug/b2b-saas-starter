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
  const [collectionAmount, setCollectionAmount] = useState('')
  const [collectionKind, setCollectionKind] = useState<'collection' | 'return'>(
    'collection'
  )
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
    void execute({
      kind: 'reschedule',
      idempotencyKey: crypto.randomUUID(),
      appointmentId: appointment.id,
      expectedRevision: revision,
      startsAt,
      endsAt: new Date(
        Date.parse(startsAt) + appointment.snapshot.durationMinutes * 60_000
      ).toISOString(),
      notification: { kind: 'notify' }
    })
  }

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
                            method: 'cash' as const,
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
                  expectedRevision: revision
                })
              }
            >
              Complete — already recorded or collect later
            </CommandButton>
            <CommandButton
              destructive
              onClick={() =>
                void execute({
                  kind: 'cancel',
                  idempotencyKey: crypto.randomUUID(),
                  appointmentId: appointment.id,
                  expectedRevisions: { [appointment.id]: revision },
                  category: 'customer_requested',
                  notification: { kind: 'notify' }
                })
              }
            >
              Cancel Appointment
            </CommandButton>
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
                category: 'merchant_unavailable',
                notification: { kind: 'notify' }
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
                category: 'customer_requested',
                notification: { kind: 'notify' }
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
                  method: 'cash',
                  recordedAt: new Date().toISOString()
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
