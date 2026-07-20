import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Feedback,
  OperationsShell,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { requireOperationsSession } from '@/lib/require-operations-session.ts'
import { getManagedOperators } from '@/lib/server/operations.ts'
import type { ManagedOperatorView } from '@/lib/server/operations.ts'

const roles = [
  'merchant-reader',
  'merchant-impersonator',
  'impersonation-auditor',
  'operator-manager'
] as const

export const Route = createFileRoute('/operators')({
  beforeLoad: requireOperationsSession,
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
        <p className="max-w-2xl text-sm text-muted-foreground">
          Roles and enabled state are read from the authoritative Operations Auth realm
          on every protected request.
        </p>
        <Link
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          search={{ result: undefined, error: undefined }}
          to="/operators/invitations/new"
        >
          Invite System Operator
        </Link>
      </div>
      {search.result ? <Feedback status>Management change completed.</Feedback> : null}
      {search.error ? <Feedback>{search.error}</Feedback> : null}
      {result.data.operators.length === 0 ? (
        <p className="mt-8 border border-border bg-card p-6">No System Operators.</p>
      ) : (
        <div className="mt-8 grid gap-6">
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
    <article className="border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{operator.name}</h2>
          <p className="font-mono text-xs text-muted-foreground">{operator.email}</p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          {operator.enabled ? 'Enabled' : 'Disabled'} · enrollment{' '}
          {operator.enrollmentState}
        </span>
      </div>
      <p className="mt-4 text-sm">
        {operator.activeSession.active ? (
          <>
            Active Operator Session until{' '}
            <time className="font-mono">
              {operator.activeSession.absoluteExpiresAt ?? 'unknown'}
            </time>
          </>
        ) : (
          'No active Operator Session'
        )}{' '}
        · last sign-in{' '}
        <time className="font-mono">{operator.lastSignInAt ?? 'never'}</time>
      </p>
      {isSelf ? (
        <p className="mt-6 rounded-md border border-border bg-muted p-4 text-sm">
          Another Operator Manager must manage your roles or enabled state.
        </p>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <form
            action={`/operators/${encodeURIComponent(operator.id)}/roles`}
            className="grid gap-4 border border-border p-4"
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
          <div className="grid content-start gap-4">
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
            <details className="border border-destructive p-4">
              <summary className="cursor-pointer text-sm font-medium text-destructive">
                Delete operator
              </summary>
              <form
                action={`/operators/${encodeURIComponent(operator.id)}/delete`}
                className="mt-4"
                method="post"
              >
                <input
                  name="expectedUpdatedAt"
                  type="hidden"
                  value={operator.updatedAt}
                />
                <button
                  className="rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground"
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
