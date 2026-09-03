import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ActionFeedback } from '@/components/page/action-feedback'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  banSystemUserServerFn,
  unbanSystemUserServerFn,
  type SystemUser
} from '@/lib/server/admin'
import { useServerAction } from '@/hooks/use-server-action'

/**
 * Row-level ban/unban for `/admin`'s users table: a confirmed destructive
 * action — the dialog names the user, cancel is the safe default. Every change
 * is re-gated by the admin role in the server fn and again inside Better
 * Auth's plugin.
 */
export function BanUserAction({ user }: { readonly user: SystemUser }) {
  const [open, setOpen] = useState(false)
  const banned = user.banned
  const verb = banned ? 'Unban' : 'Ban'

  const confirm = useServerAction(
    () =>
      banned
        ? unbanSystemUserServerFn({ data: { userId: user.id } })
        : banSystemUserServerFn({ data: { userId: user.id } }),
    { failureMessage: `${verb} failed`, onSuccess: () => setOpen(false) }
  )

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${verb} ${user.email}`}
        onClick={() => setOpen(true)}
      >
        {verb}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {verb} {user.email}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {banned
              ? 'The user will be able to sign in again.'
              : 'The user will be signed out and blocked from signing in.'}
          </AlertDialogDescription>
          {confirm.error === null ? null : <ActionFeedback error={confirm.error} />}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={confirm.pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={banned ? 'default' : 'destructive'}
              disabled={confirm.pending}
              onClick={() => confirm.run()}
            >
              {confirm.pending ? <Spinner data-icon="inline-start" /> : null}
              {verb}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
