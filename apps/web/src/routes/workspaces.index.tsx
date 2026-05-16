import { createFileRoute, Link } from '@tanstack/react-router'
import { Effect } from 'effect'
import { PublicLayout } from '@/components/public-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { runWorkspaceCapabilities } from '@/lib/capabilities'
import { requireSession } from '@/lib/server/auth'
import {
  NotificationFeed,
  StarterModuleCatalog,
  WorkspaceContext,
  WorkspaceMembership
} from '@b2b-saas-starter/capabilities'

const SHOWCASE_SLUG = 'starter-lab'

export const Route = createFileRoute('/workspaces/')({
  beforeLoad: ({ location }) => requireSession(location.href),
  loader: () =>
    runWorkspaceCapabilities(
      SHOWCASE_SLUG,
      Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const membership = yield* WorkspaceMembership
        const catalog = yield* StarterModuleCatalog
        const feed = yield* NotificationFeed
        const [members, modules, notifications] = yield* Effect.all(
          [membership.listMembers, catalog.listModules, feed.list],
          { concurrency: 'unbounded' }
        )
        return {
          workspace: ctx.workspace,
          moduleCount: modules.length,
          memberCount: members.length,
          notificationCount: notifications.length
        }
      })
    ),
  component: WorkspacesPage
})

function WorkspacesPage() {
  const { workspace, moduleCount, memberCount, notificationCount } =
    Route.useLoaderData()

  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Workspaces</h1>
        <p className="mt-3 text-muted-foreground">
          The initial scaffold ships with one deterministic seed workspace.
        </p>
        <Link
          to="/workspaces/$workspaceSlug"
          params={{ workspaceSlug: workspace.slug }}
          className="group/workspace-link mt-8 block rounded-none focus-visible:outline-none"
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
      </main>
    </PublicLayout>
  )
}
