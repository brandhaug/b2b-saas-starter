import { Link, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { FORBIDDEN_ERROR_NAME } from '@/lib/capability-error'

export function AuditRouteError({ error }: { readonly error: Error }) {
  const router = useRouter()
  const forbidden = error.name === FORBIDDEN_ERROR_NAME
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          <h1>{forbidden ? 'Audit access denied' : 'Audit trail unavailable'}</h1>
        </EmptyTitle>
        <EmptyDescription>
          {forbidden
            ? 'You do not have permission to read audit events in this workspace. Ask a workspace owner or admin.'
            : 'Audit events could not be loaded. Try again.'}
        </EmptyDescription>
      </EmptyHeader>
      {!forbidden && (
        <Button variant="outline" onClick={() => void router.invalidate()}>
          Try again
        </Button>
      )}
      <Link to="/workspaces" className="text-primary underline underline-offset-4">
        Back to workspaces
      </Link>
    </Empty>
  )
}
