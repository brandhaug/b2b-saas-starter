import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import type { ScheduleRule } from '@b2b-saas-starter/capabilities/scheduling'
import { isPostalCodeRequired } from '@b2b-saas-starter/capabilities/scheduling'
import {
  addBlockedTime,
  changeShopTimezone,
  getSchedulingConfiguration,
  previewBlockedTimeImpact,
  previewDateOverrideImpact,
  previewScheduleRulesImpact,
  previewTimezoneImpact,
  runActivationLaunchTest,
  saveActivationBusinessDetails,
  saveActivationProgress,
  saveDateOverride,
  saveScheduleRules,
  setPublicPagePublished
} from '@/lib/server/scheduling.ts'
import {
  getRecoverableOwnerActivationTestEmail,
  sendOwnerActivationTestEmail
} from '@/lib/server/transactional-email.ts'
import {
  completeOwnerActivationEmailAttempt,
  startOwnerActivationEmailAttempt,
  type OwnerActivationEmailAttempt
} from '@/lib/owner-activation-email-attempt.ts'
import { saveServiceBuffers } from '@/lib/server/merchant-catalog.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/availability')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: () => getSchedulingConfiguration(),
  component: AvailabilityPage
})

const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]

function AvailabilityPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const providerId = data.snapshot.providers[0]?.id ?? ''
  const rules = data.rules[providerId] ?? []

  return (
    <MerchantShell
      section={{ kind: 'catalog', presentation: data.snapshot.presentation }}
      title="Availability"
      description={`Recurring weekly Provider hours use ${data.merchant.timezone}. Availability is derived live; generated Time Slots are never stored.`}
    >
      <ActivationJourney
        data={data}
        pending={pending}
        onPending={setPending}
        onMessage={setMessage}
        onSaved={() => router.invalidate()}
      />
      <div className="mt-2 grid gap-3 md:mt-8 md:gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-muted/25 p-4 md:rounded-none md:bg-card md:p-5">
          <p className="text-sm font-medium">
            Owner-Provider · {data.snapshot.providers[0]?.displayName ?? 'Unavailable'}
          </p>
          <ProviderRulesForm
            key={providerId}
            providerId={providerId}
            rules={rules}
            pending={pending}
            onPending={setPending}
            onMessage={setMessage}
            onSaved={() => router.invalidate()}
          />
          <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
            {rules.map((rule) => (
              <li key={rule.id}>
                {weekdays[rule.weekday]} · {rule.startTime}–{rule.endTime}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl border bg-muted/25 p-4 md:rounded-none md:bg-card md:p-5">
          <p className="text-sm font-semibold">Booking Readiness</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.publication.readiness.ready
              ? 'Ready to publish.'
              : `Incomplete: ${data.publication.readiness.incomplete.join(', ')}`}
          </p>
          <p className="mt-5 text-sm font-semibold">
            Public Page: <span className="capitalize">{data.publication.status}</span>
          </p>
          <button
            type="button"
            disabled={
              pending ||
              (!data.publication.readiness.ready &&
                data.publication.status === 'unpublished')
            }
            onClick={() => {
              setPending(true)
              void setPublicPagePublished({
                data: { published: data.publication.status === 'unpublished' }
              })
                .then(() => router.invalidate())
                .catch(() =>
                  setMessage('Complete Booking Readiness before publishing.')
                )
                .finally(() => setPending(false))
            }}
            className="mt-3 h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground md:h-9 md:rounded-md md:px-3"
          >
            {data.publication.status === 'published' ? 'Unpublish' : 'Publish'}
          </button>
          <p className="mt-6 text-sm font-semibold">Future Availability</p>
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs text-muted-foreground">
            {data.availability?.slots.slice(0, 20).map((slot) => (
              <li key={slot.startsAt}>
                {new Date(slot.startsAt).toLocaleString('en', {
                  timeZone: data.availability!.timezone
                })}
              </li>
            )) ?? <li>Configure an eligible service and Provider.</li>}
          </ul>
        </section>
      </div>
      {message ? <p className="mt-4 text-sm text-muted-foreground">{message}</p> : null}
    </MerchantShell>
  )
}

function ActivationJourney({
  data,
  pending,
  onPending,
  onMessage,
  onSaved
}: {
  readonly data: Awaited<ReturnType<typeof getSchedulingConfiguration>>
  readonly pending: boolean
  readonly onPending: (value: boolean) => void
  readonly onMessage: (value: string) => void
  readonly onSaved: () => Promise<unknown>
}) {
  const activation = data.activation
  const [overrideDate, setOverrideDate] = useState('')
  const [overrideKind, setOverrideKind] = useState<'closed' | 'replacement_hours'>(
    'closed'
  )
  const [overrideStart, setOverrideStart] = useState('09:00')
  const [overrideEnd, setOverrideEnd] = useState('17:00')
  const [blockedStart, setBlockedStart] = useState('')
  const [blockedEnd, setBlockedEnd] = useState('')
  const [timezone, setTimezone] = useState(data.merchant.timezone)
  const [beforeBuffer, setBeforeBuffer] = useState(0)
  const [afterBuffer, setAfterBuffer] = useState(0)
  const [emailAttempt, setEmailAttempt] = useState<OwnerActivationEmailAttempt | null>(
    null
  )
  const [emailAttemptLoaded, setEmailAttemptLoaded] = useState(false)
  const [business, setBusiness] = useState({
    publicName: activation.businessDetails.publicName,
    slug: activation.businessDetails.slug,
    country: activation.businessDetails.country,
    line1: activation.businessDetails.line1,
    locality: activation.businessDetails.locality,
    postalCode: activation.businessDetails.postalCode,
    publicPhone: activation.businessDetails.publicPhone
  })
  const [policies, setPolicies] = useState(activation.policies)
  useEffect(() => {
    let active = true
    void getRecoverableOwnerActivationTestEmail()
      .then((recovered) => {
        if (!active) return
        setEmailAttempt(
          recovered
            ? completeOwnerActivationEmailAttempt(
                {
                  commandId: recovered.commandId,
                  locale: recovered.evidence.locale,
                  reuseCommand: false
                },
                recovered.evidence
              )
            : null
        )
        setEmailAttemptLoaded(true)
      })
      .catch(() => {
        if (active)
          onMessage(
            'The previous activation email attempt could not be loaded. Retry is disabled to prevent a duplicate send.'
          )
      })
    return () => {
      active = false
    }
  }, [onMessage])
  const save = <A,>(
    operation: Promise<A>,
    success: string | ((value: A) => string)
  ) => {
    onPending(true)
    onMessage('Saving…')
    void operation
      .then((value) => {
        onMessage(typeof success === 'function' ? success(value) : success)
        return onSaved()
      })
      .catch((error: unknown) =>
        onMessage(
          error instanceof Error
            ? `Save failed: ${error.message}. Your browser input is preserved.`
            : 'Save failed. Your browser input is preserved.'
        )
      )
      .finally(() => onPending(false))
  }
  const previewThenSave = async (
    preview: Promise<{
      conflictingAppointmentIds: readonly string[]
      activeHold?: boolean
    }>,
    operation: () => Promise<unknown>,
    success: string
  ) => {
    onPending(true)
    onMessage('Checking schedule impact…')
    try {
      const impact = await preview
      if (impact.activeHold)
        throw new Error('An active customer hold blocks this change')
      const accepted = window.confirm(
        impact.conflictingAppointmentIds.length
          ? `This change conflicts with ${impact.conflictingAppointmentIds.length} future Appointment(s). Existing commitments will not move. Continue?`
          : 'No future Appointment conflicts were found. Continue?'
      )
      if (!accepted) {
        onMessage('Change cancelled; browser input is preserved.')
        return
      }
      await operation()
      onMessage(success)
      await onSaved()
    } catch (error: unknown) {
      onMessage(
        error instanceof Error
          ? `Change failed: ${error.message}. Browser input is preserved.`
          : 'Change failed. Browser input is preserved.'
      )
    } finally {
      onPending(false)
    }
  }
  const confirm = (values: {
    businessDetailsConfirmed?: boolean
    ownerProviderConfirmed?: boolean
    dateOverridesReviewed?: boolean
    policies?: typeof activation.policies
    policiesConfirmed?: boolean
  }) =>
    save(
      saveActivationProgress({
        data: { expectedRevision: activation.revision, ...values }
      }),
      'Saved.'
    )
  const provider = data.snapshot.providers[0]
  const service = data.snapshot.services.find((item) => item.status === 'active')
  const slot = data.availability?.slots[0]

  return (
    <section className="mt-2 rounded-2xl border bg-card p-4 md:mt-8 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Solo activation</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Resume at: {activation.progress.resumeAt ?? 'complete'} · revision{' '}
            {activation.revision}
          </p>
        </div>
        {activation.firstActivatedAt ? (
          <span className="rounded-full border px-3 py-1 text-xs">Activated</span>
        ) : null}
      </div>
      <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {activation.progress.complete
          .concat(activation.progress.incomplete)
          .filter((step, index, all) => all.indexOf(step) === index)
          .map((step) => (
            <li key={step} className="rounded-lg border px-3 py-2">
              {activation.progress.complete.includes(step) ? '✓' : '○'}{' '}
              {step.replaceAll('-', ' ')}
            </li>
          ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => confirm({ businessDetailsConfirmed: true })}
          className="h-9 rounded-md border px-3 text-sm"
        >
          Confirm business details
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => confirm({ ownerProviderConfirmed: true })}
          className="h-9 rounded-md border px-3 text-sm"
        >
          Confirm Owner-Provider
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => confirm({ dateOverridesReviewed: true })}
          className="h-9 rounded-md border px-3 text-sm"
        >
          Confirm closures reviewed
        </button>
        <button
          type="button"
          disabled={pending || !emailAttemptLoaded}
          onClick={() => {
            const attempt = startOwnerActivationEmailAttempt(
              emailAttempt,
              () => crypto.randomUUID(),
              'en'
            )
            save(
              sendOwnerActivationTestEmail({
                data: { locale: attempt.locale, commandId: attempt.commandId }
              }),
              (evidence) => {
                setEmailAttempt(completeOwnerActivationEmailAttempt(attempt, evidence))
                return evidence.status === 'accepted' || evidence.status === 'delivered'
                  ? 'Activation email accepted.'
                  : evidence.status === 'captured'
                    ? 'Activation email captured locally; no message was delivered.'
                    : evidence.status === 'submitting'
                      ? 'Activation email submission is still in progress.'
                      : `Activation email ${evidence.status.replaceAll('_', ' ')}: ${evidence.failureCode ?? 'provider outcome unavailable'}.`
              }
            )
          }}
          className="h-9 rounded-md border px-3 text-sm"
        >
          Send test email
        </button>
        <button
          type="button"
          disabled={pending || !provider || !service || !slot}
          onClick={() =>
            provider && service && slot
              ? save(
                  runActivationLaunchTest({
                    data: {
                      providerId: provider.id,
                      serviceId: service.id,
                      startsAt: slot.startsAt,
                      customer: {
                        name: 'Launch Test',
                        email: 'launch-test@example.invalid'
                      }
                    }
                  }),
                  'Launch Test passed without creating customer data or an Appointment.'
                )
              : undefined
          }
          className="h-9 rounded-md border px-3 text-sm"
        >
          Run Launch Test
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          confirm({ policies, policiesConfirmed: true })
        }}
        className="mt-5 grid gap-2 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="grid gap-1 text-xs font-medium">
          Minimum notice (minutes)
          <input
            type="number"
            min={0}
            max={43200}
            step={15}
            value={policies.minimumNoticeMinutes}
            onChange={(event) =>
              setPolicies((current) => ({
                ...current,
                minimumNoticeMinutes: Number(event.target.value)
              }))
            }
            className="h-9 rounded-md border px-2 text-sm"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Booking horizon (days)
          <input
            type="number"
            min={1}
            max={365}
            value={policies.bookingHorizonDays}
            onChange={(event) =>
              setPolicies((current) => ({
                ...current,
                bookingHorizonDays: Number(event.target.value)
              }))
            }
            className="h-9 rounded-md border px-2 text-sm"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Cancel/reschedule cutoff (hours)
          <input
            type="number"
            min={0}
            max={720}
            value={policies.cancellationCutoffHours}
            onChange={(event) =>
              setPolicies((current) => ({
                ...current,
                cancellationCutoffHours: Number(event.target.value)
              }))
            }
            className="h-9 rounded-md border px-2 text-sm"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          Start interval
          <select
            value={policies.startTimeIntervalMinutes}
            onChange={(event) =>
              setPolicies((current) => ({
                ...current,
                startTimeIntervalMinutes: Number(event.target.value) as 5 | 10 | 15 | 30
              }))
            }
            className="h-9 rounded-md border px-2 text-sm"
          >
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
          </select>
        </label>
        <button disabled={pending} className="h-9 self-end rounded-md border text-sm">
          Save and confirm policies
        </button>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">
          Bookings confirm automatically. Payment is Pay In Person with no cancellation
          fee, no no-show charge, and no stored payment credential.
        </p>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save(
            saveActivationBusinessDetails({
              data: { expectedRevision: activation.revision, ...business }
            }),
            'Business Details saved and confirmed.'
          )
        }}
        className="mt-5 grid gap-2 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {Object.entries(business).map(([key, value]) => (
          <label key={key} className="grid gap-1 text-xs font-medium">
            {key.replace(/([A-Z])/g, ' $1')}
            <input
              required={key !== 'postalCode' || isPostalCodeRequired(business.country)}
              value={value}
              onChange={(event) =>
                setBusiness((current) => ({ ...current, [key]: event.target.value }))
              }
              className="h-9 rounded-md border px-2 text-sm"
            />
          </label>
        ))}
        <button disabled={pending} className="h-9 self-end rounded-md border text-sm">
          Save Business Details
        </button>
      </form>
      <div className="mt-5 grid gap-3 lg:grid-cols-4">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (service)
              save(
                saveServiceBuffers({
                  data: {
                    serviceId: service.id,
                    beforeBufferMinutes: beforeBuffer,
                    afterBufferMinutes: afterBuffer
                  }
                }),
                'Service buffers saved.'
              )
          }}
          className="grid gap-2 rounded-xl border p-3"
        >
          <label className="text-xs font-medium">Service buffers (minutes)</label>
          <input
            aria-label="Before buffer"
            type="number"
            min={0}
            max={120}
            step={5}
            value={beforeBuffer}
            onChange={(event) => setBeforeBuffer(Number(event.target.value))}
            className="h-9 rounded-md border px-2"
          />
          <input
            aria-label="After buffer"
            type="number"
            min={0}
            max={120}
            step={5}
            value={afterBuffer}
            onChange={(event) => setAfterBuffer(Number(event.target.value))}
            className="h-9 rounded-md border px-2"
          />
          <button
            disabled={pending || !service}
            className="h-9 rounded-md border text-sm"
          >
            Save buffers
          </button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const input = {
              localDate: overrideDate,
              kind: overrideKind,
              intervals:
                overrideKind === 'closed'
                  ? []
                  : [{ startTime: overrideStart, endTime: overrideEnd }],
              expectedRevision:
                data.controls.dateOverrides.find(
                  (item) => item.localDate === overrideDate
                )?.revision ?? 0
            }
            void previewThenSave(
              previewDateOverrideImpact({ data: input }),
              () => saveDateOverride({ data: input }),
              'Date Override saved; existing Appointments were preserved.'
            )
          }}
          className="grid gap-2 rounded-xl border p-3"
        >
          <label className="text-xs font-medium">Close a local date</label>
          <input
            type="date"
            required
            value={overrideDate}
            onChange={(event) => setOverrideDate(event.target.value)}
            className="h-9 rounded-md border px-2"
          />
          <select
            value={overrideKind}
            onChange={(event) =>
              setOverrideKind(event.target.value as 'closed' | 'replacement_hours')
            }
            className="h-9 rounded-md border px-2 text-sm"
          >
            <option value="closed">Closed</option>
            <option value="replacement_hours">Replacement hours</option>
          </select>
          {overrideKind === 'replacement_hours' ? (
            <div className="grid grid-cols-2 gap-2">
              <input
                aria-label="Override start"
                type="time"
                step={300}
                value={overrideStart}
                onChange={(event) => setOverrideStart(event.target.value)}
                className="h-9 rounded-md border px-2"
              />
              <input
                aria-label="Override end"
                type="time"
                step={300}
                value={overrideEnd}
                onChange={(event) => setOverrideEnd(event.target.value)}
                className="h-9 rounded-md border px-2"
              />
            </div>
          ) : null}
          <button disabled={pending} className="h-9 rounded-md border text-sm">
            Save override
          </button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const input = {
              startsAt: new Date(blockedStart).toISOString(),
              endsAt: new Date(blockedEnd).toISOString(),
              reason: 'Owner blocked time'
            }
            void previewThenSave(
              previewBlockedTimeImpact({ data: input }),
              () => addBlockedTime({ data: input }),
              'Blocked Time saved; existing Appointments were preserved.'
            )
          }}
          className="grid gap-2 rounded-xl border p-3"
        >
          <label className="text-xs font-medium">Blocked Time</label>
          <input
            type="datetime-local"
            required
            value={blockedStart}
            onChange={(event) => setBlockedStart(event.target.value)}
            className="h-9 rounded-md border px-2"
          />
          <input
            type="datetime-local"
            required
            value={blockedEnd}
            onChange={(event) => setBlockedEnd(event.target.value)}
            className="h-9 rounded-md border px-2"
          />
          <button disabled={pending} className="h-9 rounded-md border text-sm">
            Preview and save block
          </button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void previewThenSave(
              previewTimezoneImpact({ data: { timezone } }),
              () => changeShopTimezone({ data: { timezone, confirmed: true } }),
              'Timezone changed; exact Appointment and Blocked Time instants were preserved.'
            )
          }}
          className="grid gap-2 rounded-xl border p-3"
        >
          <label className="text-xs font-medium">Shop timezone</label>
          <input
            required
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="h-9 rounded-md border px-2"
          />
          <button
            disabled={pending || timezone === data.merchant.timezone}
            className="h-9 rounded-md border text-sm"
          >
            Preview impact and confirm
          </button>
        </form>
      </div>
    </section>
  )
}

type DraftRule = {
  readonly key: string
  readonly weekday: number
  readonly startTime: string
  readonly endTime: string
}

function ProviderRulesForm({
  providerId,
  rules,
  pending,
  onPending,
  onMessage,
  onSaved
}: {
  readonly providerId: string
  readonly rules: readonly ScheduleRule[]
  readonly pending: boolean
  readonly onPending: (pending: boolean) => void
  readonly onMessage: (message: string) => void
  readonly onSaved: () => Promise<unknown>
}) {
  const [drafts, setDrafts] = useState<readonly DraftRule[]>(() =>
    rules.map((rule) => ({ ...rule, key: rule.id }))
  )
  const update = (key: string, values: Partial<Omit<DraftRule, 'key'>>) =>
    setDrafts((current) =>
      current.map((rule) => (rule.key === key ? { ...rule, ...values } : rule))
    )

  return (
    <div className="mt-5 grid gap-3">
      {drafts.map((rule) => (
        <div
          key={rule.key}
          className="grid grid-cols-2 items-center gap-2 md:grid-cols-[6rem_1fr_1fr_auto]"
        >
          <select
            aria-label="Weekday"
            value={rule.weekday}
            onChange={(event) =>
              update(rule.key, { weekday: Number(event.target.value) })
            }
            className="col-span-2 h-10 rounded-xl border bg-card px-3 text-sm md:col-span-1 md:h-9 md:rounded-md md:px-2 md:text-xs"
          >
            {weekdays.map((day, weekday) => (
              <option key={day} value={weekday}>
                {day.slice(0, 3)}
              </option>
            ))}
          </select>
          <input
            aria-label="Start time"
            type="time"
            required
            value={rule.startTime}
            onChange={(event) => update(rule.key, { startTime: event.target.value })}
            className="h-10 rounded-xl border bg-card px-2 text-sm md:h-9 md:rounded-md md:text-xs"
          />
          <input
            aria-label="End time"
            type="time"
            required
            value={rule.endTime}
            onChange={(event) => update(rule.key, { endTime: event.target.value })}
            className="h-10 rounded-xl border bg-card px-2 text-sm md:h-9 md:rounded-md md:text-xs"
          />
          <button
            type="button"
            onClick={() =>
              setDrafts((current) => current.filter((item) => item.key !== rule.key))
            }
            className="col-span-2 h-9 justify-self-end px-2 text-xs text-muted-foreground md:col-span-1 md:justify-self-auto"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setDrafts((current) => [
            ...current,
            {
              key: `new-${Date.now()}`,
              weekday: 1,
              startTime: '09:00',
              endTime: '17:00'
            }
          ])
        }
        className="h-10 rounded-xl border px-3 text-sm md:h-9 md:rounded-md"
      >
        Add interval
      </button>
      <button
        type="button"
        disabled={pending || !providerId}
        onClick={() => {
          onPending(true)
          const nextRules = drafts.map(({ key: _, ...rule }) => rule)
          void previewScheduleRulesImpact({ data: { providerId, rules: nextRules } })
            .then((impact) =>
              window.confirm(
                impact.conflictingAppointmentIds.length
                  ? `These hours conflict with ${impact.conflictingAppointmentIds.length} future Appointment(s). Existing commitments will be preserved. Continue?`
                  : 'No future Appointment conflicts were found. Save these hours?'
              )
                ? saveScheduleRules({ data: { providerId, rules: nextRules } })
                : Promise.reject(new Error('cancelled'))
            )
            .then(() => {
              onMessage('Recurring hours saved.')
              return onSaved()
            })
            .catch(() =>
              onMessage('Use valid weekly intervals with each end after its start.')
            )
            .finally(() => onPending(false))
        }}
        className="h-10 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground md:h-9 md:rounded-md"
      >
        Save weekly hours
      </button>
    </div>
  )
}
