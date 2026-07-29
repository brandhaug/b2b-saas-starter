import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  Feedback,
  OperationsShell,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui'
import { requireOperationsSession } from '@/lib/require-operations-session'
import {
  getMessagingCase,
  resolveMessagingCase
} from '@/lib/server/operations-server-functions'

export const Route = createFileRoute('/messaging_/cases/$caseId')({
  beforeLoad: requireOperationsSession,
  loader: ({ params }) => getMessagingCase({ data: params.caseId }),
  component: MessagingCaseRoute
})

function MessagingCaseRoute() {
  const result = Route.useLoaderData()
  const router = useRouter()
  const [mutation, setMutation] = useState<
    Awaited<ReturnType<typeof resolveMessagingCase>> | undefined
  >()
  if (result.state !== 'ready')
    return (
      <OperationsShell eyebrow="Operational Messaging" title="Messaging case">
        <ScreenState result={result} />
      </OperationsShell>
    )
  const detail = result.data
  return (
    <OperationsShell eyebrow="Focused evidence journey" title="Messaging case">
      <section className="grid gap-3 border border-border bg-card p-5 sm:grid-cols-2">
        <Fact label="Merchant" value={detail.case.merchantName ?? 'Platform-wide'} />
        <Fact label="Destination" value={detail.intent.maskedDestination ?? 'Erased'} />
        <Fact label="Intent" value={detail.intent.intentId} mono />
        <Fact label="Purpose" value={detail.intent.purpose ?? 'Unavailable'} />
      </section>
      <EvidenceSection title="Ordered route journey">
        {detail.routes.map((route) => (
          <li className="border border-border bg-card p-4" key={route.routeId}>
            <p className="font-medium">
              {route.ordinal + 1}. {route.channel} · {route.provider}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{route.state}</p>
          </li>
        ))}
      </EvidenceSection>
      <EvidenceSection title="Submission attempts">
        {detail.attempts.map((attempt) => (
          <li className="border border-border bg-card p-4" key={attempt.attemptId}>
            <p className="font-mono text-sm">{attempt.attemptId}</p>
            <p className="mt-1 text-sm text-muted-foreground">{attempt.state}</p>
          </li>
        ))}
      </EvidenceSection>
      <EvidenceSection title="Normalized provider evidence">
        {detail.evidence.map((evidence) => (
          <li className="border border-border bg-card p-4" key={evidence.evidenceId}>
            <p className="font-medium">
              {evidence.status} · {evidence.source}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {evidence.trusted ? 'Trusted' : 'Untrusted'}
              {evidence.normalizedCode ? ` · ${evidence.normalizedCode}` : ''}
            </p>
          </li>
        ))}
      </EvidenceSection>
      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Reservation and Merchant charge</h2>
          <p className="mt-3 text-sm">
            {detail.reservation
              ? `${detail.reservation.amountMilliEuro} m€ · ${detail.reservation.status}`
              : 'No reservation'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail.charges.length
              ? `${detail.charges[0]!.chargeMilliEuro} m€ charged`
              : 'No Chargeable Delivery'}
          </p>
        </div>
        <div className="border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Provider costs</h2>
          <p className="mt-3 text-sm">{providerCostSummary(detail.providerCosts)}</p>
        </div>
      </section>
      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Reconciliation state</h2>
          <p className="mt-3 text-sm capitalize">{detail.reconciliation.status}</p>
          {detail.reconciliation.resolutions.map((resolution) => (
            <div
              className="mt-3 border-t border-border pt-3 text-sm"
              key={`${resolution.source}:${resolution.createdAt}`}
            >
              <p className="font-medium">{resolution.classification}</p>
              <p className="mt-1 text-muted-foreground">
                {resolution.source} · {resolution.disposition}
              </p>
              <p className="mt-1 text-muted-foreground">{resolution.reason}</p>
            </div>
          ))}
        </div>
        <div className="border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Linked complaints</h2>
          {detail.complaints.length ? (
            <ul className="mt-3 grid gap-2">
              {detail.complaints.map((complaint) => (
                <li className="text-sm" key={complaint.caseId}>
                  {complaint.safeSummary} · {complaint.status}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No linked complaint activity.
            </p>
          )}
        </div>
      </section>
      <section className="mt-8 border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Append reconciliation resolution</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          This appends a classified resolution and source. Provider Evidence remains
          immutable. Your current Messaging Reconciler permission is checked again when
          submitted.
        </p>
        <form
          className="mt-5 grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const response = await resolveMessagingCase({
              data: {
                caseId: detail.case.caseId,
                disposition: 'resolved',
                classification: String(form.get('classification') ?? ''),
                source: String(form.get('source') ?? ''),
                reason: String(form.get('reason') ?? ''),
                confirmed: form.get('confirmed') === 'yes'
              }
            })
            setMutation(response)
            if (response.state === 'ready') await router.invalidate()
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium">
            Resolution classification
            <input
              className="h-9 rounded-md border border-input bg-card px-3"
              maxLength={1000}
              name="classification"
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Evidence source
            <input
              className="h-9 rounded-md border border-input bg-card px-3"
              maxLength={1000}
              name="source"
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Substantive reason
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
            Confirm append-only resolution
          </label>
          <div>
            <SubmitButton>Append resolution</SubmitButton>
          </div>
        </form>
        {mutation ? (
          <Feedback status={mutation.state === 'ready'}>
            {mutation.state === 'ready'
              ? 'Resolution appended.'
              : 'message' in mutation
                ? mutation.message
                : 'Resolution state changed.'}
          </Feedback>
        ) : null}
      </section>
    </OperationsShell>
  )
}

function EvidenceSection({
  title,
  children
}: {
  readonly title: string
  readonly children: React.ReactNode
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ol className="mt-3 grid gap-3">{children}</ol>
    </section>
  )
}
function Fact({
  label,
  value,
  mono = false
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

const providerCostSummary = (
  costs: readonly {
    readonly amountMinorUnits: number
    readonly currency: string
    readonly currencyScale: number
  }[]
) => {
  if (costs.length === 0) return 'No provider cost facts'
  const totals = new Map<string, number>()
  for (const cost of costs) {
    const amount = cost.amountMinorUnits / 10 ** cost.currencyScale
    totals.set(cost.currency, (totals.get(cost.currency) ?? 0) + amount)
  }
  return [...totals].map(([currency, amount]) => `${amount} ${currency}`).join(' · ')
}
