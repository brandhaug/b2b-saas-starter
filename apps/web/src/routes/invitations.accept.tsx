import { type AcceptedInvitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { pageTitle } from '@/components/page/page-title'
import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { MailCheckIcon } from 'lucide-react'
import { PublicLayout } from '@/components/public-layout'
import { RoutePending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { requireSession } from '@/lib/server/auth'
import { roleVariant } from '@/lib/badge-variants'
import { Spinner } from '@/components/ui/spinner'
import {
  acceptInvitationServerFn,
  invitationPreviewServerFn,
  type InvitationPreview
} from '@/lib/server/invitations'
import { callServerFn } from '@/lib/server-call'
import { pickOptionalStrings } from '@/lib/utils'

const ACCEPT_FAILED = 'Could not accept the invitation'

// The destination of the link `sendInvitationServerFn` emails. It sits outside
// the /workspaces subtree on purpose: that subtree's routes resolve a workspace
// the visitor must already be a member of, and the whole point of an invitation
// is that they are not one yet.
// `invitation` is optional so an older link still renders the unusable-invitation
// notice instead of a search-validation error: the API worker used to email
// `?workspace=<slug>`, which carried no id, and issue #64 removed that endpoint
// rather than leave it sending a link nobody could accept.

const UNUSABLE: InvitationPreview = { state: 'unavailable' }

export const Route = createFileRoute('/invitations/accept')({
  validateSearch: (search) => pickOptionalStrings(search, ['invitation']),
  loaderDeps: ({ search }) => ({ invitation: search.invitation }),
  // Its own gate: /workspaces owns the subtree gate and this route is not in it.
  // Anonymous visitors sign in first — an invitation is addressed to an email
  // address, so there is nothing to match until we know who is asking.
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href)
    return { session }
  },
  // `async` so the no-id branch returns a resolved promise without reaching for
  // a Promise constructor; the loader contract is promise-returning either way.
  loader: async ({ deps }) => {
    if (deps.invitation === undefined) {
      return UNUSABLE
    }
    return invitationPreviewServerFn({ data: { invitationId: deps.invitation } })
  },
  pendingComponent: RoutePending,
  component: AcceptInvitationRoute,
  head: () => ({ meta: [{ title: pageTitle('Accept invitation') }] })
})

/**
 * Reads the loader payload and supplies the real accept call. The page itself
 * takes both as props, so a test renders it without a router loader or a
 * session.
 */
function AcceptInvitationRoute() {
  return (
    <AcceptInvitationPage
      preview={Route.useLoaderData()}
      accept={acceptInvitationServerFn}
    />
  )
}

/**
 * The one server call this page makes, as a port. The route passes
 * `acceptInvitationServerFn`; a test passes a double, which is what lets the
 * page's two outcomes — joined, or refused with a reason — be asserted without
 * a session (`invitations.accept.test.tsx`).
 */
export type AcceptInvitation = (input: {
  readonly data: { readonly invitationId: string }
}) => Promise<AcceptedInvitation>

export function AcceptInvitationPage({
  preview,
  accept
}: {
  readonly preview: InvitationPreview
  readonly accept: AcceptInvitation
}) {
  // One opaque outcome for every unusable invitation — see `InvitationPreview`.
  if (preview.state === 'unavailable') {
    return <UnusableInvitation />
  }
  // Split rather than branching inside one component: the accept handler is a
  // closure, and a closure defined after an early return does not inherit the
  // narrowing that return produced.
  return <PendingInvitation preview={preview} accept={accept} />
}

function UnusableInvitation() {
  return (
    <PublicLayout>
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-lg flex-1 place-items-center px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle as="h1">This invitation cannot be used</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm text-muted-foreground">
            {/* Naming which failure it was would tell a link-guesser whether a
                given workspace exists. */}
            <p>
              It may have expired, been cancelled, already been accepted, or been sent
              to a different address. Ask whoever invited you to send a new one.
            </p>
            <Button
              render={<Link to="/workspaces" />}
              variant="secondary"
              className="justify-self-start"
            >
              Go to your workspaces
            </Button>
          </CardContent>
        </Card>
      </main>
    </PublicLayout>
  )
}

function PendingInvitation({
  preview,
  accept: acceptInvitation
}: {
  readonly preview: Extract<InvitationPreview, { readonly state: 'pending' }>
  readonly accept: AcceptInvitation
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setSubmitting(true)
    setError(null)
    // oxlint-disable-next-line effect/noTryCatch -- an event handler resetting a loading flag, not Effect control flow: `finally` clears the flag on rejection too, so a failed accept never leaves the button disabled forever.
    try {
      const outcome = await callServerFn(
        () => acceptInvitation({ data: { invitationId: preview.invitationId } }),
        ACCEPT_FAILED
      )
      if (!outcome.ok) {
        setError(outcome.message)
        return
      }
      await router.navigate({
        to: '/workspaces/$workspaceSlug',
        params: { workspaceSlug: outcome.value.workspaceSlug }
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PublicLayout>
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-lg flex-1 place-items-center px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle as="h1" className="flex items-center gap-2">
              <MailCheckIcon className="size-5 text-muted-foreground" />
              Join {preview.workspaceName}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              You have been invited to {preview.workspaceName} as{' '}
              <Badge variant={roleVariant(preview.role)}>{preview.role}</Badge>.
              Accepting adds you to the workspace.
            </p>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex items-center gap-3">
              <Button onClick={() => void accept()} disabled={submitting}>
                {submitting ? <Spinner data-icon="inline-start" /> : null}
                Accept invitation
              </Button>
              <Button render={<Link to="/workspaces" />} variant="ghost">
                Not now
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </PublicLayout>
  )
}
