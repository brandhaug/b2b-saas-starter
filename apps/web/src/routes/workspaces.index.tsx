import { ChevronRightIcon } from 'lucide-react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { CreateWorkspaceForm } from '@/components/create-workspace-form'
import { EmailVerificationBanner } from '@/components/email-verification-banner'
import { PageHeader } from '@/components/page/page-header'
import { pageTitle } from '@/components/page/page-title'
import { Panel } from '@/components/page/panel'
import { WorkspaceShell } from '@/components/workspace-shell'
import { RoutePending } from '@/components/route-pending'
import { getTurnstileSiteKey } from '@/lib/server/turnstile'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import {
  useWorkspaceDirectory,
  type WorkspaceDirectory
} from '@/lib/workspace-directory'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/workspaces/')({
  // The list itself is the layout route's directory load — possibly empty,
  // never a 404; an empty array renders the empty state below. The one read
  // here is the Turnstile site key the unverified-email banner's resend needs
  // (env-gated: `null` renders no widget and sends no token).
  loader: () => getTurnstileSiteKey(),
  pendingComponent: RoutePending,
  component: WorkspacesPage,
  head: () => ({ meta: [{ title: pageTitle(m.public_meta_workspaces()) }] })
})

function WorkspacesPage() {
  const workspaces: WorkspaceDirectory = useWorkspaceDirectory() ?? []
  const session = Route.useRouteContext().session
  const turnstileSiteKey = Route.useLoaderData()
  const navigate = useNavigate()

  return (
    <WorkspaceShell viewer={null} systemRole={session.user.role} workspaceSlug={null}>
      <PageHeader
        title={m.page_workspaces()}
        description={m.page_workspaces_description()}
      />
      {/* The unverified state surfaces here rather than gating anything:
          verification is encouraged, not enforced (provider-light rule). */}
      {session.user.emailVerified ? null : (
        <EmailVerificationBanner
          email={session.user.email}
          turnstileSiteKey={turnstileSiteKey}
        />
      )}
      <Panel title={m.page_workspaces()}>
        {workspaces.length === 0 ? (
          <div className="grid gap-5">
            {/* Creating is the way in: the creator becomes the workspace's
              first owner, so a fresh account never needs a seed script or
              an existing owner to let them in. */}
            <p className="text-sm text-muted-foreground">
              {m.empty_no_workspace_membership()}
            </p>
            <CreateWorkspaceForm
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
                      {m.members_count_label()},{' '}
                      <span className="font-mono tabular-nums">
                        {notificationCount}
                      </span>{' '}
                      {m.notifications_count_label()}
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
