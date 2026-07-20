import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Field,
  OperationsShell,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { getAuditEvents } from '@/lib/server/operations.ts'

type AuditSearch = {
  readonly action?: string
  readonly result?: string
  readonly operator?: string
  readonly merchant?: string
  readonly target?: string
  readonly cursor?: string
}

export const Route = createFileRoute('/audit')({
  validateSearch: (search: Record<string, unknown>): AuditSearch =>
    Object.fromEntries(
      Object.entries(search).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    ),
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
        className="grid gap-4 border border-slate-200 bg-white p-5 md:grid-cols-3"
        method="get"
      >
        <Field label="Action" name="action" />
        <label className="grid gap-1.5 text-sm font-medium">
          Result
          <select
            className="h-10 rounded border border-slate-300 bg-white px-3"
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
        <p className="mt-8 border border-slate-200 bg-white p-5 text-sm text-slate-600">
          No matching Operations audit events.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto border border-slate-200 bg-white">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-3">Action</th>
                <th className="p-3">Result</th>
                <th className="p-3">Real operator</th>
                <th className="p-3">Merchant</th>
                <th className="p-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {page.data.events.map((event) => (
                <tr key={event.id}>
                  <td className="p-3">
                    <Link
                      className="text-blue-700"
                      params={{ eventId: event.id }}
                      to="/audit/$eventId"
                    >
                      {event.action}
                    </Link>
                  </td>
                  <td className="p-3 capitalize">{event.result}</td>
                  <td className="p-3">
                    {event.actor?.displayName ?? 'Not applicable'}
                  </td>
                  <td className="p-3">
                    {event.merchant?.displayName ?? 'Not applicable'}
                  </td>
                  <td className="p-3">
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
          className="mt-5 inline-flex text-sm text-blue-700"
          search={{ ...search, cursor: page.data.nextCursor }}
          to="/audit"
        >
          Older audit events →
        </Link>
      ) : null}
    </OperationsShell>
  )
}
