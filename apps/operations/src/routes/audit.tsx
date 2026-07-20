import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Field,
  OperationsShell,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { requireOperationsSession } from '@/lib/require-operations-session.ts'
import { getAuditEvents } from '@/lib/server/operations-server-functions.ts'

type AuditSearch = {
  readonly action?: string
  readonly result?: string
  readonly operator?: string
  readonly merchant?: string
  readonly target?: string
  readonly cursor?: string
}

export const Route = createFileRoute('/audit')({
  beforeLoad: requireOperationsSession,
  validateSearch: (search: Record<string, unknown>): AuditSearch => {
    const text = (name: string) => {
      const value = search[name]
      return typeof value === 'string' && value.trim() ? value : undefined
    }
    const action = text('action')
    const operator = text('operator')
    const merchant = text('merchant')
    const target = text('target')
    const cursor = text('cursor')
    const result = search.result
    return {
      ...(action ? { action } : {}),
      ...(result === 'accepted' || result === 'rejected' ? { result } : {}),
      ...(operator ? { operator } : {}),
      ...(merchant ? { merchant } : {}),
      ...(target ? { target } : {}),
      ...(cursor ? { cursor } : {})
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getAuditEvents({ data: deps }),
  component: AuditPage
})

function AuditPage() {
  const page = Route.useLoaderData()
  const search = Route.useSearch()
  if (page.state !== 'ready')
    return (
      <OperationsShell eyebrow="Global evidence" title="Operations audit">
        <ScreenState result={page} />
      </OperationsShell>
    )
  return (
    <OperationsShell eyebrow="Global evidence" title="Operations audit">
      <form
        className="grid gap-4 border border-border bg-card p-6 md:grid-cols-3"
        method="get"
      >
        <Field label="Action" name="action" />
        <label className="grid gap-1.5 text-sm font-medium">
          Result
          <select
            className="h-9 rounded-md border border-input bg-card px-3"
            name="result"
            defaultValue={search.result ?? ''}
          >
            <option value="">Any</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <Field label="Real operator ID" name="operator" />
        <Field label="Merchant ID" name="merchant" />
        <Field label="Target ID" name="target" />
        <SubmitButton>Filter audit</SubmitButton>
      </form>
      {page.data.events.length === 0 ? (
        <p className="mt-8 border border-border bg-card p-6 text-sm text-muted-foreground">
          No matching Operations audit events.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto border border-border bg-card">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-4">Action</th>
                <th className="p-4">Result</th>
                <th className="p-4">Real operator</th>
                <th className="p-4">Merchant</th>
                <th className="p-4">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {page.data.events.map((event) => (
                <tr key={event.id}>
                  <td className="p-4">
                    <Link
                      className="text-primary"
                      params={{ eventId: event.id }}
                      to="/audit/$eventId"
                    >
                      {event.action}
                    </Link>
                  </td>
                  <td className="p-4 capitalize">{event.result}</td>
                  <td className="p-4">
                    {event.actor?.displayName ?? 'Not applicable'}
                  </td>
                  <td className="p-4">
                    {event.merchant?.displayName ?? 'Not applicable'}
                  </td>
                  <td className="p-4 font-mono">
                    <time dateTime={event.occurredAt}>{event.occurredAt}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.data.nextCursor ? (
        <Link
          className="mt-6 text-sm text-primary"
          search={{ ...search, cursor: page.data.nextCursor }}
          to="/audit"
        >
          Older audit events →
        </Link>
      ) : null}
    </OperationsShell>
  )
}
