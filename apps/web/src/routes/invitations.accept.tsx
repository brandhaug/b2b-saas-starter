import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Cause, Effect, Exit, Option, Schema } from 'effect'
import { MailCheckIcon } from 'lucide-react'
import { PublicLayout } from '@/components/public-layout'
import { RoutePending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { causeMessage } from '@/lib/cause-message'
import { requireSession } from '@/lib/server/auth'
import {
  acceptInvitationServerFn,
  invitationPreviewServerFn,
  type InvitationPreview
} from '@/lib/server/invitations'

const ACCEPT_FAILED = 'Could not accept the invitation'

// The destination of the link `sendInvitationServerFn` emails. It sits outside
// the /workspaces subtree on purpose: that subtree's routes resolve a workspace
// the visitor must already be a member of, and the whole point of an invitation
// is that they are not one yet.
// `invitation` is optional so an older link still renders the unusable-invitation
// notice instead of a search-validation error. `apps/api`'s `invitations.send`
// emails `?workspace=<slug>`, which never carried an id and cannot until that
// endpoint can persist an invitation (issue #64).
const AcceptSearch = Schema.Struct({
  invitation: Schema.optional(Schema.String)
})

const decodeSearch = Schema.decodeUnknownSync(AcceptSearch)

const UNUSABLE: InvitationPreview = { state: 'unavailable' }

export const Route = createFileRoute('/invitations/accept')({
  validateSearch: (search) => decodeSearch(search),
  // Its own gate: /workspaces owns the subtree gate and this route is not in it.
  // Anonymous visitors sign in first — an invitation is addressed to an email
  // address, so there is nothing to match until we know who is asking.
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href)
    return { session }
  },
  loaderDeps: ({ search }) => ({ invitation: search.invitation }),
  // `async` so the no-id branch returns a resolved promise without reaching for
  // a Promise constructor; the loader contract is promise-returning either way.
  loader: async ({ deps }) => {
    if (deps.invitation === undefined) return UNUSABLE
    return invitationPreviewServerFn({ data: { invitationId: deps.invitation } })
  },
  pendingComponent: RoutePending,
  component: AcceptInvitationPage
})

function AcceptInvitationPage() {
  const preview = Route.useLoaderData()

  // One opaque outcome for every unusable invitation — see `InvitationPreview`.
  if (preview.state === 'unavailable') return <UnusableInvitation />
  // Split rather than branching inside one component: the accept handler is a
  // closure, and a closure defined after an early return does not inherit the
  // narrowing that return produced.
  return <PendingInvitation preview={preview} />
}

function UnusableInvitation() {
  return (
    <PublicLayout>
      <Card className="mx-auto mt-16 max-w-lg">
        <CardHeader>
          <CardTitle>This invitation cannot be used</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground">
          {/* Naming which failure it was would tell a link-guesser whether a
              given workspace exists. */}
          <p>
            It may have expired, been cancelled, already been accepted, or been sent to
            a different address. Ask whoever invited you to send a new one.
          </p>
          <Link
            to="/workspaces"
            className="inline-flex h-9 items-center justify-self-start bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            Go to your workspaces
          </Link>
        </CardContent>
      </Card>
    </PublicLayout>
  )
}

function PendingInvitation({
  preview
}: {
  readonly preview: Extract<InvitationPreview, { readonly state: 'pending' }>
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setSubmitting(true)
    setError(null)
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: () =>
          acceptInvitationServerFn({ data: { invitationId: preview.invitationId } }),
        catch: (cause) => causeMessage(cause, ACCEPT_FAILED)
      })
    )
    if (Exit.isFailure(exit)) {
      setSubmitting(false)
      setError(Option.getOrElse(Cause.findErrorOption(exit.cause), () => ACCEPT_FAILED))
      return
    }
    await router.navigate({
      to: '/workspaces/$workspaceSlug',
      params: { workspaceSlug: exit.value.workspaceSlug }
    })
  }

  return (
    <PublicLayout>
      <Card className="mx-auto mt-16 max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailCheckIcon className="size-5 text-muted-foreground" />
            Join {preview.workspaceName}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            You have been invited to {preview.workspaceName} as{' '}
            <Badge variant="secondary">{preview.role}</Badge>. Accepting adds you to the
            workspace.
          </p>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <Button onClick={() => void accept()} disabled={submitting}>
              {submitting ? 'Joining…' : 'Accept invitation'}
            </Button>
            <Link
              to="/workspaces"
              className="inline-flex h-9 items-center px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Not now
            </Link>
          </div>
        </CardContent>
      </Card>
    </PublicLayout>
  )
}
