import { createFileRoute, Link } from '@tanstack/react-router'
import {
  OperationsShell,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { getManagedOperators } from '@/lib/server/operations.ts'
import type { ManagedOperatorView } from '@/lib/server/operations.ts'

const roles = [
  'merchant-reader',
  'merchant-impersonator',
  'impersonation-auditor',
  'operator-manager'
] as const

export const Route = createFileRoute('/operators')({
  validateSearch: (search: Record<string, unknown>) => ({
    result: typeof search.result === 'string' ? search.result : undefined,
    error: typeof search.error === 'string' ? search.error : undefined
  }),
  loader: () => getManagedOperators(),
  component: OperatorsPage
})

function OperatorsPage() {
  const result = Route.useLoaderData()
  const search = Route.useSearch()
  if (result.state !== 'ready')
    return (
      <OperationsShell eyebrow="Operator management" title="System Operators">
        <ScreenState result={result} />
      </OperationsShell>
    )
  return (
    <OperationsShell eyebrow="Operator management" title="System Operators">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-sm text-slate-600">
          Roles and enabled state are read from the authoritative Operations Auth realm
          on every protected request.
        </p>
        <Link
          className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white"
          search={{ result: undefined, error: undefined }}
          to="/operators/invitations/new"
        >
          Invite System Operator
        </Link>
      </div>
      {search.result ? (
        <output className="mt-5 rounded bg-emerald-50 p-3 text-sm text-emerald-800">
          Management change completed.
        </output>
      ) : null}
      {search.error ? (
        <p className="mt-5 rounded bg-red-50 p-3 text-sm text-red-800" role="alert">
          {search.error}
        </p>
      ) : null}
      {result.data.operators.length === 0 ? (
        <p className="mt-8 border border-slate-200 bg-white p-5">
          No System Operators.
        </p>
      ) : (
        <div className="mt-8 grid gap-5">
          {result.data.operators.map((operator) => (
            <OperatorCard
              actorOperatorId={result.data.actorOperatorId}
              key={operator.id}
              operator={operator}
            />
          ))}
        </div>
      )}
    </OperationsShell>
  )
}

function OperatorCard({
  actorOperatorId,
  operator
}: {
  readonly actorOperatorId: string
  readonly operator: ManagedOperatorView
}) {
  const isSelf = operator.id === actorOperatorId
  return (
    <article className="border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{operator.name}</h2>
          <p className="font-mono text-xs text-slate-500">{operator.email}</p>
        </div>
        <span
          className={`rounded px-2 py-1 text-xs ${operator.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
        >
          {operator.enabled ? 'Enabled' : 'Disabled'} · enrollment{' '}
          {operator.enrollmentState}
        </span>
      </div>
      <p className="mt-4 text-sm">
        {operator.activeSession.active
          ? `Active Operator Session until ${operator.activeSession.absoluteExpiresAt ?? 'unknown'}`
          : 'No active Operator Session'}{' '}
        · last sign-in {operator.lastSignInAt ?? 'never'}
      </p>
      {isSelf ? (
        <p className="mt-5 rounded bg-amber-50 p-3 text-sm text-amber-900">
          Another Operator Manager must manage your roles or enabled state.
        </p>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <form
            action={`/operators/${encodeURIComponent(operator.id)}/roles`}
            className="grid gap-3 border border-slate-200 p-4"
            method="post"
          >
            <input name="expectedUpdatedAt" type="hidden" value={operator.updatedAt} />
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-semibold">Operator roles</legend>
              {roles.map((role) => (
                <label className="flex gap-2 text-sm" key={role}>
                  <input
                    defaultChecked={operator.roles.includes(role)}
                    name="roles"
                    type="checkbox"
                    value={role}
                  />
                  {role}
                </label>
              ))}
            </fieldset>
            <SubmitButton>Save roles</SubmitButton>
          </form>
          <div className="grid content-start gap-3">
            <form
              action={`/operators/${encodeURIComponent(operator.id)}/enabled`}
              method="post"
            >
              <input
                name="expectedUpdatedAt"
                type="hidden"
                value={operator.updatedAt}
              />
              <input
                name="enabled"
                type="hidden"
                value={operator.enabled ? 'false' : 'true'}
              />
              <SubmitButton>
                {operator.enabled ? 'Disable operator' : 'Enable operator'}
              </SubmitButton>
            </form>
            <details className="border border-red-200 p-4">
              <summary className="cursor-pointer text-sm font-medium text-red-800">
                Delete operator
              </summary>
              <form
                action={`/operators/${encodeURIComponent(operator.id)}/delete`}
                className="mt-3"
                method="post"
              >
                <input
                  name="expectedUpdatedAt"
                  type="hidden"
                  value={operator.updatedAt}
                />
                <button
                  className="rounded bg-red-700 px-4 py-2 text-sm text-white"
                  type="submit"
                >
                  Confirm delete
                </button>
              </form>
            </details>
          </div>
        </div>
      )}
    </article>
  )
}
