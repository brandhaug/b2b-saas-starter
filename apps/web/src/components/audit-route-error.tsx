import { isStrongAuthenticationError } from '@/lib/ui-error'
import { SupportDetails } from '@/components/support-details'
import { Link, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { FORBIDDEN_ERROR_NAME } from '@/lib/capability-error'
import { m } from '@b2b-saas-starter/i18n/messages'
import { StrongAuthenticationNotice } from './strong-authentication-notice'

export function AuditRouteError({ error }: { readonly error: Error }) {
  const router = useRouter()
  if (isStrongAuthenticationError(error)) {
    return <StrongAuthenticationNotice />
  }
  const forbidden = error.name === FORBIDDEN_ERROR_NAME
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          <h1>{forbidden ? m.audit_access_denied() : m.audit_unavailable()}</h1>
        </EmptyTitle>
        <EmptyDescription>
          {forbidden ? m.audit_forbidden_description() : m.audit_load_failed()}
        </EmptyDescription>
      </EmptyHeader>
      {!forbidden && (
        <Button variant="outline" onClick={() => void router.invalidate()}>
          {m.try_again()}
        </Button>
      )}
      <Link to="/workspaces" className="text-primary underline underline-offset-4">
        {m.back_to_workspaces()}
      </Link>
      <SupportDetails routeName="audit" />
      <Link
        to="/help"
        reloadDocument
        className="text-primary underline underline-offset-4"
      >
        {m.public_meta_support()}
      </Link>
    </Empty>
  )
}
