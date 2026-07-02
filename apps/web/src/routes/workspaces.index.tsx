import { createFileRoute, Link } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import { RoutePending } from '@/components/route-pending'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { runCapabilities } from '@/lib/capabilities'
import { listWorkspacesForUser } from '@b2b-saas-starter/capabilities'

export const Route = createFileRoute('/workspaces/')({
  // "My workspaces" is a cross-workspace projection: possibly empty, never a
  // 404 — an empty array renders the empty state below.
  loader: ({ context }) =>
    runCapabilities(listWorkspacesForUser(context.session.user.id)),
  pendingComponent: RoutePending,
  component: WorkspacesPage
})

function WorkspacesPage() {
  const workspaces = Route.useLoaderData()

  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Workspaces</h1>
        <p className="mt-3 text-muted-foreground">
          Every workspace your account is a member of.
        </p>
        {workspaces.length === 0 ? (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>No workspaces yet</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Your account is not a member of any workspace. Run{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  bun run db:seed
                </code>{' '}
                and sign in with the demo credentials, or ask a workspace owner to add
                you.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-8 grid gap-4">
            {workspaces.map(
              ({ workspace, moduleCount, memberCount, notificationCount }) => (
                <Link
                  key={workspace.id}
                  to="/workspaces/$workspaceSlug"
                  params={{ workspaceSlug: workspace.slug }}
                  className="group/workspace-link block rounded-none focus-visible:outline-none"
                >
                  <Card className="transition-colors hover:bg-muted/40 group-focus-visible/workspace-link:ring-2 group-focus-visible/workspace-link:ring-ring group-focus-visible/workspace-link:ring-offset-2">
                    <CardHeader>
                      <CardTitle>{workspace.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {moduleCount} starter modules, {memberCount} members,{' '}
                        {notificationCount} notifications
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              )
            )}
          </div>
        )}
      </main>
    </PublicLayout>
  )
}
