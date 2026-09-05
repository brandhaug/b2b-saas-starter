import { useRouter } from '@tanstack/react-router'
import { UserRoundSearchIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useServerAction } from '@/hooks/use-server-action'
import {
  stopImpersonatingWithServerFn,
  type ImpersonationState,
  type StopImpersonating
} from '@/lib/impersonation'

export { type StopImpersonating }

/**
 * The visible impersonation state ADR 0024 asked for before impersonation
 * could ship: on every shell page, above the header, for as long as the
 * session is an impersonation (ADR 0054). Stop restores the admin's own
 * session cookie server-side, then re-runs the route gates so the shell
 * re-renders as the admin and lands back on `/admin`.
 */
export function ImpersonationBanner({
  impersonation,
  stopImpersonating = stopImpersonatingWithServerFn
}: {
  readonly impersonation: ImpersonationState
  readonly stopImpersonating?: StopImpersonating
}) {
  const router = useRouter()
  const stopping = useServerAction(
    async () => {
      await stopImpersonating()
      await router.invalidate()
      await router.navigate({ to: '/admin' })
    },
    { failureMessage: 'Could not stop impersonating', invalidate: false }
  )
  return (
    // `role="status"`, not `alert`: the banner is on the page from first paint
    // for the whole session — an assertive live region would interrupt on
    // every load.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see above
    <Alert role="status" variant="destructive" className="rounded-none border-x-0">
      <UserRoundSearchIcon />
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-foreground">
          You are impersonating <strong>{impersonation.userName}</strong>{' '}
          <span className="text-muted-foreground">({impersonation.userEmail})</span>.
          Password, two-factor, email and account deletion are locked for this session.
          {stopping.error === null ? null : (
            <span role="alert" className="text-destructive">
              {' '}
              {stopping.error}
            </span>
          )}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={stopping.pending}
          onClick={() => stopping.run()}
        >
          {stopping.pending ? <Spinner data-icon="inline-start" /> : null}
          Stop impersonating
        </Button>
      </AlertDescription>
    </Alert>
  )
}
