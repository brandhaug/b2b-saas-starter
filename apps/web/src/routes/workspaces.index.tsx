import { ChevronRightIcon } from 'lucide-react'
import { listWorkspacesForUser } from '@b2b-saas-starter/capabilities/workspace-projections'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { CreateWorkspaceForm } from '@/components/create-workspace-form'
import { EmailVerificationBanner } from '@/components/email-verification-banner'
import { PageHeader } from '@/components/page/page-header'
import { pageTitle } from '@/components/page/page-title'
import { Panel } from '@/components/page/panel'
import { WorkspaceShell } from '@/components/workspace-shell'
import { RoutePending } from '@/components/route-pending'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { runCapabilities } from '@/lib/capabilities'

export const Route = createFileRoute('/workspaces/')({
  // "My workspaces" is a cross-workspace projection: possibly empty, never a
  // 404 — an empty array renders the empty state below.
  loader: ({ context }) =>
    runCapabilities(listWorkspacesForUser(context.session.user.id)),
  pendingComponent: RoutePending,
  component: WorkspacesPage,
  head: () => ({ meta: [{ title: pageTitle('Your workspaces') }] })
})

function WorkspacesPage() {
  const workspaces = Route.useLoaderData()
  const session = Route.useRouteContext().session
  const navigate = useNavigate()

  return (
    <WorkspaceShell viewer={null} systemRole={session.user.role} workspaceSlug={null}>
      <PageHeader
        title="Your workspaces"
        description="Every workspace your account is a member of."
      />
      {/* The unverified state surfaces here rather than gating anything:
          verification is encouraged, not enforced (provider-light rule). */}
      {session.user.emailVerified ? null : (
        <EmailVerificationBanner email={session.user.email} />
      )}
      <Panel title="Your workspaces">
        {workspaces.length === 0 ? (
          <div className="grid gap-5">
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
          </div>
        ) : (
          <ItemGroup>
            {workspaces.map(({ workspace, memberCount, notificationCount }) => (
              <Link
                key={workspace.id}
                to="/workspaces/$workspaceSlug"
                params={{ workspaceSlug: workspace.slug }}
                className="group/workspace-link block rounded-none focus-visible:outline-none"
              >
                <Item
                  variant="outline"
                  className="transition-colors group-focus-visible/workspace-link:ring-2 group-focus-visible/workspace-link:ring-ring"
                >
                  <ItemContent>
                    <ItemTitle>{workspace.name}</ItemTitle>
                    <ItemDescription>
                      <span className="font-mono tabular-nums">{memberCount}</span>{' '}
                      members,{' '}
                      <span className="font-mono tabular-nums">
                        {notificationCount}
                      </span>{' '}
                      notifications
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ChevronRightIcon
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  </ItemActions>
                </Item>
              </Link>
            ))}
          </ItemGroup>
        )}
      </Panel>
    </WorkspaceShell>
  )
}
