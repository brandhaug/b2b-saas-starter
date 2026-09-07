import { unwrapAuthResult, type AuthResult } from '@/lib/auth-result'
import { authClient } from '@/lib/auth-client'
import { loginMethodLabel } from '@/components/auth/social-provider-labels'
import { useAuthClientAction, useAuthClientRows } from '@/hooks/use-auth-client-rows'
import { Button } from '@/components/ui/button'
import { ActionFeedback } from '@/components/page/action-feedback'
import { formatTimestamp } from '@/lib/format-date'
import { m } from '@b2b-saas-starter/i18n/messages'
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

const ACCOUNTS_QUERY_KEY: ReadonlyArray<unknown> = ['account', 'linked-providers']

/**
 * One linked sign-in method, narrowed to the fields the panel reads: `id` is
 * the account row's id — the value `unlinkAccount` takes — and `providerId`
 * is the method ('credential' for email and password).
 */
type LinkedAccountRecord = {
  readonly id: string
  readonly providerId: string
  readonly createdAt: Date
}

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
      linkedLabel: formatTimestamp(linked.createdAt, { dateStyle: 'medium' })
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
export function LinkedAccountsPanel() {
  const { hydrated, rows, loadError, isPending, refetch } = useAuthClientRows({
    queryKey: ACCOUNTS_QUERY_KEY,
    list: () => authClient.listAccounts(),
    toRows: toViewModels,
    loadFailedMessage: m.load_linked_providers_failed()
  })
  const act = useAuthClientAction({
    refetch,
    call: (action: () => Promise<AuthResult<unknown>>) =>
      unwrapAuthResult(action, m.linked_account_unlink_failed()),
    failureMessage: m.linked_account_unlink_failed()
  })

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
                    {m.linked_label()} {row.linkedLabel}
                  </p>
                </div>
                {canUnlink ? (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          aria-label={m.unlink_named({ name: row.methodLabel })}
                        />
                      }
                    >
                      {m.unlink_action()}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>
                        {m.unlink_named({ name: row.methodLabel })}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {m.provider_unlinked_description()}
                      </AlertDialogDescription>
                      <div className="flex justify-end gap-2">
                        <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            act.run(() =>
                              authClient.unlinkAccount({ accountId: row.accountId })
                            )
                          }
                        >
                          {m.unlink_action()}
                        </AlertDialogAction>
                      </div>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {m.add_sign_in_method_before_removing()}
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
