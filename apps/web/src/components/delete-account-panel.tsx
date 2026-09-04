import { Link } from '@tanstack/react-router'
import { TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { useServerAction } from '@/hooks/use-server-action'
import { describeDeleteFailure } from '@/lib/delete-account-failure'
import { deleteAccountServerFn, type AccountDeletionPlan } from '@/lib/server/account'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

/** The stable module-scope adapter the panel defaults its port to. */
function runDeleteAccount(input: { readonly password: string }) {
  return deleteAccountServerFn({ data: input })
}

/**
 * Self-service account deletion for the signed-in user. The plan arrives from
 * the route's loader (the capability computed it); the panel renders its
 * consequences and owns one password confirmation. A blocked plan shows the
 * workspaces to fix first, with a link to each one's members page, and no
 * delete control — the server refuses regardless, this is presentation.
 *
 * Success ends the session server-side (the endpoint revokes every session),
 * so the panel leaves for `/sign-in` with a full page load — no client cache
 * of a signed-in state survives the account it was issued to.
 */
export function DeleteAccountPanel({
  plan,
  deleteAccount = runDeleteAccount
}: {
  readonly plan: AccountDeletionPlan
  readonly deleteAccount?: (input: {
    readonly password: string
  }) => Promise<AccountDeletionPlan>
}) {
  const [password, setPassword] = useState('')
  const [confirming, setConfirming] = useState(false)

  const remove = useServerAction(
    (input: { readonly password: string }) => deleteAccount(input),
    {
      failureMessage: 'Could not delete the account',
      describeFailure: describeDeleteFailure,
      // The next view of this account belongs to `/sign-in`, loaded fresh.
      invalidate: false,
      onSuccess: () => {
        window.location.assign('/sign-in')
      }
    }
  )

  if (!plan.canDelete) {
    const blocked = plan.steps.filter((step) => step.action === 'blocked_sole_owner')
    return (
      <section className="grid gap-4" aria-label="Delete account">
        <div
          role="alert"
          className="flex items-start gap-2 rounded-none border border-border bg-muted/40 px-4 py-3"
        >
          <TriangleAlertIcon
            className="mt-0.5 size-4 shrink-0 text-status-warn"
            aria-hidden
          />
          <div className="grid gap-1 text-sm">
            <p>
              Your account is the only owner of{' '}
              {blocked.length === 1 ? 'a workspace' : `${blocked.length} workspaces`}{' '}
              with other members. Transfer ownership first.
            </p>
            <ul className="grid gap-1">
              {blocked.map((step) => (
                <li key={step.workspace.id}>
                  <Link
                    to="/workspaces/$workspaceSlug/members"
                    params={{ workspaceSlug: step.workspace.slug }}
                    className="text-primary underline underline-offset-2"
                  >
                    {step.workspace.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    )
  }

  const leaving = plan.steps.filter((step) => step.action === 'leave')
  const deleting = plan.steps.filter((step) => step.action === 'delete_workspace')

  return (
    <section className="grid gap-4" aria-label="Delete account">
      <p className="text-sm text-muted-foreground">
        Deleting your account is permanent. Every session is signed out, and:
      </p>
      <ul className="grid gap-1 text-sm text-muted-foreground">
        {leaving.length > 0 ? (
          <li>
            You leave{' '}
            {leaving.length === 1 ? 'workspace' : `${leaving.length} workspaces`}{' '}
            {leaving.map((step) => step.workspace.name).join(', ')} — other owners keep
            it.
          </li>
        ) : null}
        {deleting.length > 0 ? (
          <li>
            {deleting.length === 1 ? 'Workspace' : `${deleting.length} workspaces`}{' '}
            {deleting.map((step) => step.workspace.name).join(', ')}{' '}
            {deleting.length === 1 ? 'is' : 'are'} deleted with the account.
          </li>
        ) : null}
        {leaving.length === 0 && deleting.length === 0 ? (
          <li>No workspace is affected.</li>
        ) : null}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setConfirming(true)
        }}
        className="grid gap-3"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="delete-account-password">Password</Label>
          <Input
            id="delete-account-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        <Button
          type="submit"
          variant="destructive"
          className="w-fit"
          disabled={remove.pending}
        >
          Delete account
        </Button>
      </form>
      {remove.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {remove.error}
        </p>
      )}
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. Your sessions end and the workspaces listed above are
            left or deleted as described.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false)
                remove.run({ password })
                setPassword('')
              }}
            >
              Yes, delete my account
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
