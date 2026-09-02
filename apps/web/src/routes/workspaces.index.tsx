import { listWorkspacesForUser } from '@b2b-saas-starter/capabilities/workspace-projections'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { CreateWorkspaceForm } from '@/components/create-workspace-form'
import { EmailVerificationBanner } from '@/components/email-verification-banner'
import { WorkspaceShell } from '@/components/workspace-shell'
import { RoutePending } from '@/components/route-pending'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { runCapabilities } from '@/lib/capabilities'

export const Route = createFileRoute('/workspaces/')({
  // "My workspaces" is a cross-workspace projection: possibly empty, never a
  // 404 — an empty array renders the empty state below.
  loader: ({ context }) =>
    runCapabilities(listWorkspacesForUser(context.session.user.id)),
  pendingComponent: RoutePending,
  component: WorkspacesPage,
  head: () => ({ meta: [{ title: 'Your workspaces | B2B SaaS Starter' }] })
})

function WorkspacesPage() {
  const workspaces = Route.useLoaderData()
  const session = Route.useRouteContext().session
  const navigate = useNavigate()

  return (
    <WorkspaceShell
      viewer={null}
      systemRole={session.user.role}
      workspaceSlug={null}
      title="Workspaces"
      description="Every workspace your account is a member of."
    >
      <div className="mx-auto w-full max-w-4xl">
        {/* The unverified state surfaces here rather than gating anything:
              verification is encouraged, not enforced (provider-light rule). */}
        {session.user.emailVerified ? null : (
          <div className="mt-6">
            <EmailVerificationBanner email={session.user.email} />
          </div>
        )}
        {workspaces.length === 0 ? (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle as="h2">No workspaces yet</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              {/* Creating is the way in: the creator becomes the workspace's
                first owner, so a fresh account never needs a seed script or
                an existing owner to let them in. */}
              <p className="text-sm text-muted-foreground">
                Your account is not a member of any workspace. Create one below and you
                will be its first owner, or ask a workspace owner to add you.
              </p>
              <CreateWorkspaceForm
                userId={session.user.id}
                onCreated={(workspace) =>
                  void navigate({
                    to: '/workspaces/$workspaceSlug',
                    params: { workspaceSlug: workspace.slug }
                  })
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="mt-8 grid gap-4">
            {workspaces.map(({ workspace, memberCount, notificationCount }) => (
              <Link
                key={workspace.id}
                to="/workspaces/$workspaceSlug"
                params={{ workspaceSlug: workspace.slug }}
                className="group/workspace-link block rounded-none focus-visible:outline-none"
              >
                <Card className="transition-colors hover:bg-muted/40 group-focus-visible/workspace-link:ring-2 group-focus-visible/workspace-link:ring-ring group-focus-visible/workspace-link:ring-offset-2">
                  <CardHeader>
                    <CardTitle as="h2">{workspace.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-mono tabular-nums">{memberCount}</span>{' '}
                      members,{' '}
                      <span className="font-mono tabular-nums">
                        {notificationCount}
                      </span>{' '}
                      notifications
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  )
}
