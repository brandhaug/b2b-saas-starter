import { createFileRoute, Link } from '@tanstack/react-router'
import { OperationsShell, ScreenState, SubmitButton } from '@/components/operations-ui'
import { requireOperationsSession } from '@/lib/require-operations-session'
import { getMessagingOverview } from '@/lib/server/operations-server-functions'

type MessagingSearch = { readonly q: string }

export const Route = createFileRoute('/messaging')({
  validateSearch: (search: Record<string, unknown>): MessagingSearch => ({
    q: typeof search.q === 'string' ? search.q.slice(0, 100) : ''
  }),
  loaderDeps: ({ search }) => search,
  beforeLoad: requireOperationsSession,
  loader: ({ deps }) => getMessagingOverview({ data: { query: deps.q } }),
  component: MessagingOverviewRoute
})

function MessagingOverviewRoute() {
  const result = Route.useLoaderData()
  if (result.state !== 'ready')
    return (
      <OperationsShell eyebrow="Operational Messaging" title="Messaging health">
        <ScreenState result={result} />
      </OperationsShell>
    )
  const { health, cases } = result.data
  return (
    <OperationsShell eyebrow="Operational Messaging" title="Messaging health">
      <nav className="flex flex-wrap gap-2" aria-label="Messaging workspaces">
        <WorkspaceLink label="Case queue" to="/messaging" />
        <WorkspaceLink label="Containment" to="/messaging/containment" />
        <WorkspaceLink label="Finance" to="/messaging/finance" />
      </nav>
      <section
        className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        aria-label="Messaging health summary"
      >
        <HealthFact label="Open cases" value={health.openCaseCount} />
        <HealthFact label="Ambiguous" value={health.ambiguousCount} />
        <HealthFact label="Complaints" value={health.complaintCount} />
        <HealthFact label="Delivered routes" value={health.deliveredRouteCount} />
        <HealthFact
          label="Merchant charges"
          value={`${health.merchantChargeMilliEuro} m€`}
        />
        <HealthFact
          label="Provider costs (EUR)"
          value={`${health.providerCostMilliEuro} m€`}
        />
      </section>
      <search>
        <form className="mt-8 flex flex-col gap-3 sm:flex-row" method="get">
          <label className="grid flex-1 gap-1.5 text-sm font-medium">
            Search messaging cases
            <input
              className="h-9 rounded-md border border-input bg-card px-3"
              maxLength={100}
              name="q"
              placeholder="Intent, attempt, Merchant, or last 3 digits"
            />
          </label>
          <div className="self-end">
            <SubmitButton>Search cases</SubmitButton>
          </div>
        </form>
      </search>
      <section className="mt-8" aria-live="polite">
        <h2 className="text-xl font-semibold">Case queue</h2>
        {cases.length === 0 ? (
          <p className="mt-4 border border-border bg-card p-6 text-sm text-muted-foreground">
            No matching messaging cases.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {cases.map((item) => (
              <li className="border border-border bg-card p-4" key={item.caseId}>
                <div className="flex flex-col justify-between gap-3 sm:flex-row">
                  <div>
                    <Link
                      className="font-medium text-primary"
                      params={{ caseId: item.caseId }}
                      to="/messaging/cases/$caseId"
                    >
                      {item.safeSummary}
                    </Link>
                    <p className="mt-1 text-sm">
                      {item.merchantName ?? 'Platform-wide'} ·{' '}
                      {item.maskedDestination ?? 'Destination erased'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {purposeLabel(item.purpose)} · Age: {ageLabel(item.openedAt)}
                    </p>
                  </div>
                  <p className="text-sm capitalize text-muted-foreground sm:text-right">
                    {item.status}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </OperationsShell>
  )
}

function WorkspaceLink({
  label,
  to
}: {
  readonly label: string
  readonly to: '/messaging' | '/messaging/containment' | '/messaging/finance'
}) {
  return (
    <Link
      className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium"
      search={{ q: '' }}
      to={to}
    >
      {label}
    </Link>
  )
}

function HealthFact({
  label,
  value
}: {
  readonly label: string
  readonly value: string | number
}) {
  return (
    <div className="border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  )
}

const purposeLabel = (purpose: string | undefined) =>
  purpose
    ? purpose
        .split('_')
        .map((part, index) =>
          index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part
        )
        .join(' ')
    : 'Purpose unavailable'

const ageLabel = (openedAt: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(openedAt)) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}
