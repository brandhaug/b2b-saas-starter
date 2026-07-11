import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CatalogShell } from '@/components/catalog-shell.tsx'
import type { ScheduleRule } from '@b2b-saas-starter/capabilities/scheduling'
import {
  getSchedulingConfiguration,
  saveScheduleRules,
  setPublicPagePublished
} from '@/lib/server/scheduling.ts'
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
  const [providerId, setProviderId] = useState(data.snapshot.providers[0]?.id ?? '')
  const rules = data.rules[providerId] ?? []

  return (
    <CatalogShell
      catalog={data.snapshot}
      title="Availability"
      description={`Recurring weekly Provider hours use ${data.merchant.timezone}. Availability is derived live; generated Time Slots are never stored.`}
    >
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="border bg-card p-5">
          <label className="grid gap-2 text-sm font-medium">
            Provider
            <select
              className="h-9 rounded-md border bg-card px-3"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              {data.snapshot.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </label>
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
        <section className="border bg-card p-5">
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
            className="mt-3 h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
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
    </CatalogShell>
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
          className="grid grid-cols-[6rem_1fr_1fr_auto] items-center gap-2"
        >
          <select
            aria-label="Weekday"
            value={rule.weekday}
            onChange={(event) =>
              update(rule.key, { weekday: Number(event.target.value) })
            }
            className="h-9 rounded-md border bg-card px-2 text-xs"
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
            className="h-9 rounded-md border bg-card px-2 text-xs"
          />
          <input
            aria-label="End time"
            type="time"
            required
            value={rule.endTime}
            onChange={(event) => update(rule.key, { endTime: event.target.value })}
            className="h-9 rounded-md border bg-card px-2 text-xs"
          />
          <button
            type="button"
            onClick={() =>
              setDrafts((current) => current.filter((item) => item.key !== rule.key))
            }
            className="h-9 px-2 text-xs text-muted-foreground"
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
        className="h-9 rounded-md border px-3 text-sm"
      >
        Add interval
      </button>
      <button
        type="button"
        disabled={pending || !providerId}
        onClick={() => {
          onPending(true)
          void saveScheduleRules({
            data: {
              providerId,
              rules: drafts.map(({ key: _, ...rule }) => rule)
            }
          })
            .then(() => {
              onMessage('Recurring hours saved.')
              return onSaved()
            })
            .catch(() =>
              onMessage('Use valid weekly intervals with each end after its start.')
            )
            .finally(() => onPending(false))
        }}
        className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
      >
        Save weekly hours
      </button>
    </div>
  )
}
