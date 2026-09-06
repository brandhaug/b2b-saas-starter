import { type ImpersonationStarted } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { impersonateUserServerFn, type SystemUser } from '@/lib/server/admin'
import { useServerAction } from '@/hooks/use-server-action'
import { m } from '@b2b-saas-starter/i18n/messages'

/** The one server call this action makes, as a port. */
export type ImpersonateUser = (input: {
  readonly data: { readonly userId: string }
}) => Promise<ImpersonationStarted>

/**
 * Row-level "Impersonate" for `/admin`'s users table (ADR 0054): a confirmed
 * action that names the user and what the session may not do. System Admins
 * get no button — the capability and the plugin both refuse them, so a
 * control that always fails would only teach the admin to ignore errors.
 * After the cookie swap the route gates re-run and the shell re-renders as
 * the impersonated user, banner included.
 */
export function ImpersonateUserAction({
  user,
  impersonate = impersonateUserServerFn
}: {
  readonly user: SystemUser
  readonly impersonate?: ImpersonateUser
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const confirm = useServerAction(
    async () => {
      await impersonate({ data: { userId: user.id } })
      await router.invalidate()
      await router.navigate({ to: '/workspaces' })
    },
    { failureMessage: m.impersonation_failed(), invalidate: false }
  )

  if (user.role === 'admin') {
    return null
  }

  return (
    <>
      <Button
        variant="ghost"
        aria-label={m.impersonate_title({ email: user.email })}
        onClick={() => setOpen(true)}
      >
        {m.impersonate_action()}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {m.impersonate_title({ email: user.email })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {m.impersonate_description({ name: user.name })}
          </AlertDialogDescription>
          {confirm.error === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {confirm.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={confirm.pending}>
              {m.common_cancel()}
            </AlertDialogCancel>
            <AlertDialogAction disabled={confirm.pending} onClick={() => confirm.run()}>
              {confirm.pending ? <Spinner data-icon="inline-start" /> : null}
              {m.impersonate_action()}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
