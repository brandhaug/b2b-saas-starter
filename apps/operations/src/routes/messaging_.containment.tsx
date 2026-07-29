import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  Feedback,
  OperationsShell,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui'
import { requireOperationsSession } from '@/lib/require-operations-session'
import {
  containMessagingIncident,
  getMessagingContainment,
  getMessagingIncidents
} from '@/lib/server/operations-server-functions'

export const Route = createFileRoute('/messaging_/containment')({
  beforeLoad: requireOperationsSession,
  loader: async () => ({
    containment: await getMessagingContainment(),
    incidents: await getMessagingIncidents()
  }),
  component: MessagingContainmentRoute
})

function MessagingContainmentRoute() {
  const { containment, incidents } = Route.useLoaderData()
  const router = useRouter()
  const [mutation, setMutation] = useState<
    Awaited<ReturnType<typeof containMessagingIncident>> | undefined
  >()
  if (containment.state !== 'ready')
    return (
      <OperationsShell eyebrow="Privileged messaging" title="Containment">
        <ScreenState result={containment} />
      </OperationsShell>
    )
  if (incidents.state !== 'ready')
    return (
      <OperationsShell eyebrow="Privileged messaging" title="Containment">
        <ScreenState result={incidents} />
      </OperationsShell>
    )
  return (
    <OperationsShell eyebrow="Privileged messaging" title="Containment">
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        Current provider/channel posture is separate from routine investigation.
        Accepted actions require an authoritative permission recheck, a narrow scope, a
        safe before/after preview, a substantive reason, and confirmation.
      </p>
      <Link
        className="mt-5 inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium"
        search={{ q: '' }}
        to="/messaging"
      >
        Back to case queue
      </Link>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Channel posture</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {containment.data.controls.map((control) => (
            <li className="border border-border bg-card p-4" key={control.controlId}>
              <p className="font-medium capitalize">
                {control.channel} · {control.provider}
              </p>
              <p className="mt-1 text-sm">
                {control.environment} · {control.enabled ? 'Enabled' : 'Paused'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {control.reason ?? 'No active containment reason'}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Messaging incidents</h2>
        {incidents.data.incidents.length ? (
          <ul className="mt-4 grid gap-3">
            {incidents.data.incidents.map((incident) => (
              <li
                className="border border-border bg-card p-4"
                key={incident.incidentId}
              >
                <p className="font-medium">{incident.safeSummary}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {incident.status} · {incident.containmentScope}
                </p>
                {incident.status === 'open' ? (
                  <form
                    className="mt-5 grid gap-4 border-t border-border pt-5"
                    onSubmit={async (event) => {
                      event.preventDefault()
                      const form = new FormData(event.currentTarget)
                      const response = await containMessagingIncident({
                        data: {
                          incidentId: incident.incidentId,
                          reason: String(form.get('reason') ?? ''),
                          confirmed: form.get('confirmed') === 'yes'
                        }
                      })
                      setMutation(response)
                      if (response.state === 'ready') await router.invalidate()
                    }}
                  >
                    <div
                      aria-label="Containment preview"
                      className="grid gap-2 rounded-md bg-muted p-4 text-sm sm:grid-cols-2"
                    >
                      <p>Before: {incident.status}</p>
                      <p>After: contained</p>
                      <p className="sm:col-span-2">
                        Scope: {incident.containmentScope}
                        {incident.shopId ? ` · ${incident.shopId}` : ''}
                      </p>
                    </div>
                    <label className="grid gap-1.5 text-sm font-medium">
                      Containment reason
                      <textarea
                        className="min-h-24 rounded-md border border-input bg-card p-3"
                        maxLength={1000}
                        minLength={12}
                        name="reason"
                        required
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                      <input name="confirmed" required type="checkbox" value="yes" />
                      Confirm narrow containment
                    </label>
                    <div>
                      <SubmitButton>Contain incident</SubmitButton>
                    </div>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 border border-border bg-card p-5 text-sm text-muted-foreground">
            No messaging incidents.
          </p>
        )}
      </section>
      {mutation ? (
        <Feedback status={mutation.state === 'ready'}>
          {mutation.state === 'ready'
            ? 'Incident contained.'
            : 'message' in mutation
              ? mutation.message
              : 'Containment state changed.'}
        </Feedback>
      ) : null}
    </OperationsShell>
  )
}
