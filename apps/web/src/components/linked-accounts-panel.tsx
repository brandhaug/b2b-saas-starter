import { useQuery } from '@tanstack/react-query'
import { useHydrated } from '@/lib/client-only-value'
import { unwrapAuthResult, type AuthResult } from '@/lib/auth-result'
import {
  listAccountsWithAuthClient,
  unlinkAccountWithAuthClient,
  type LinkedAccountRecord,
  type ListLinkedAccounts,
  type UnlinkAccount
} from '@/components/auth/auth-client-ports'
import { loginMethodLabel } from '@/components/auth/social-provider-labels'
import { useServerAction } from '@/hooks/use-server-action'
import { Button } from '@/components/ui/button'
import { ActionFeedback } from '@/components/page/action-feedback'
import { formatUtc } from '@/lib/format-date'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'

export type {
  ListLinkedAccounts,
  UnlinkAccount
} from '@/components/auth/auth-client-ports'

const ACCOUNTS_QUERY_KEY: ReadonlyArray<unknown> = ['account', 'linked-providers']
const ACTION_FAILED = 'The provider could not be unlinked'

/** One row of the panel's view model; dates formatted client-side only. */
export type LinkedAccountRowView = {
  readonly accountId: string
  readonly methodLabel: string
  readonly linkedLabel: string
}

function toViewModels(
  accounts: ReadonlyArray<LinkedAccountRecord>
): Array<LinkedAccountRowView> {
  return accounts
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((linked) => ({
      accountId: linked.id,
      methodLabel: loginMethodLabel(linked.providerId),
      linkedLabel: formatUtc(linked.createdAt, { dateStyle: 'medium' })
    }))
}

/**
 * Linked sign-in methods for the signed-in user: one row per account — email
 * and password plus every social provider — with an unlink control that stays
 * available only while another sign-in method remains. Better Auth refuses
 * unlinking the last account; the disabled control is the honest presentation
 * of that rule, not the enforcement. Body of the route's `Panel` (which owns
 * the title), with the same shape as `PasskeysPanel` and `SessionsPanel`: the
 * list is this panel's own query, so actions refetch it instead of
 * invalidating the route, and every failure reads through `ActionFeedback`.
 */
export function LinkedAccountsPanel({
  listAccounts = listAccountsWithAuthClient,
  unlinkAccount = unlinkAccountWithAuthClient
}: {
  readonly listAccounts?: ListLinkedAccounts
  readonly unlinkAccount?: UnlinkAccount
}) {
  const hydrated = useHydrated()
  const {
    data: rows,
    error: queryError,
    isPending,
    refetch
  } = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: async (): Promise<ReadonlyArray<LinkedAccountRowView>> => {
      const result = await listAccounts()
      if (result.error) {
        // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- TanStack Query surfaces failure states by rejecting the query function; there is no Effect channel here
        throw new Error(result.error.message ?? 'Could not load linked providers')
      }
      return toViewModels(result.data ?? [])
    },
    enabled: hydrated,
    retry: false
  })
  const loadError = queryError?.message ?? null
  const act = useServerAction(
    (action: () => Promise<AuthResult<unknown>>) =>
      unwrapAuthResult(action, ACTION_FAILED),
    {
      failureMessage: ACTION_FAILED,
      invalidate: false,
      onSuccess: () => {
        void refetch()
      }
    }
  )

  const canUnlink = (rows?.length ?? 0) > 1

  return (
    <>
      <ActionFeedback error={loadError} />
      <ActionFeedback error={act.error} />

      {hydrated && isPending ? (
        <ul className="grid gap-2" aria-busy="true">
          {[0, 1].map((index) => (
            <li key={index} className="rounded-sm border border-border px-3 py-2">
              <Skeleton className="h-4 w-40" />
            </li>
          ))}
        </ul>
      ) : null}
      {Array.isArray(rows) ? (
        <ul className="grid gap-2">
          {rows.map((row) => {
            return (
              <li
                key={row.accountId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{row.methodLabel}</p>
                  <p className="text-xs font-mono tabular-nums text-muted-foreground">
                    Linked {row.linkedLabel}
                  </p>
                </div>
                {canUnlink ? (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Unlink ${row.methodLabel}`}
                        />
                      }
                    >
                      Unlink
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>Unlink {row.methodLabel}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        That provider can no longer sign in to this account.
                      </AlertDialogDescription>
                      <div className="flex justify-end gap-2">
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            act.run(() => unlinkAccount({ accountId: row.accountId }))
                          }
                        >
                          Unlink
                        </AlertDialogAction>
                      </div>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Add another sign-in method before removing this one
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </>
  )
}
