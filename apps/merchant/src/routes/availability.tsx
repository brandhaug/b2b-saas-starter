import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CatalogShell } from '@/components/catalog-shell.tsx'
import { formValue } from '@/lib/form-value.ts'
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
          <form
            className="mt-5 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const nextRules = weekdays.flatMap((_, weekday) =>
                form.get(`enabled-${weekday}`) === 'on'
                  ? [
                      {
                        weekday,
                        startTime: formValue(form, `start-${weekday}`),
                        endTime: formValue(form, `end-${weekday}`)
                      }
                    ]
                  : []
              )
              setPending(true)
              void saveScheduleRules({ data: { providerId, rules: nextRules } })
                .then(() => {
                  setMessage('Recurring hours saved.')
                  return router.invalidate()
                })
                .catch(() =>
                  setMessage(
                    'Use a valid weekly interval with the end after the start.'
                  )
                )
                .finally(() => setPending(false))
            }}
          >
            {weekdays.map((day, weekday) => {
              const rule = rules.find((item) => item.weekday === weekday)
              return (
                <div
                  key={`${providerId}-${day}`}
                  className="grid grid-cols-[7rem_1fr_1fr] items-center gap-2"
                >
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      name={`enabled-${weekday}`}
                      type="checkbox"
                      defaultChecked={Boolean(rule)}
                    />
                    {day.slice(0, 3)}
                  </label>
                  <input
                    aria-label={`${day} start time`}
                    name={`start-${weekday}`}
                    type="time"
                    defaultValue={rule?.startTime ?? '09:00'}
                    className="h-9 rounded-md border bg-card px-2 text-xs"
                  />
                  <input
                    aria-label={`${day} end time`}
                    name={`end-${weekday}`}
                    type="time"
                    defaultValue={rule?.endTime ?? '17:00'}
                    className="h-9 rounded-md border bg-card px-2 text-xs"
                  />
                </div>
              )
            })}
            <button
              disabled={pending || !providerId}
              className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              Save weekly hours
            </button>
          </form>
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
