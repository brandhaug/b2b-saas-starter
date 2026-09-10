import { ChevronRightIcon } from 'lucide-react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { type CreatedWorkspace } from '@b2b-saas-starter/capabilities/governance/workspace-lifecycle'
import {
  CreateWorkspaceForm,
  type CreateWorkspace
} from '@/components/create-workspace-form'
import { EmailVerificationBanner } from '@/components/email-verification-banner'
import { PageHeader } from '@/components/page/page-header'
import { pageTitle } from '@/components/page/page-title'
import { CreateAction, Panel } from '@/components/page/panel'
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
import {
  useWorkspaceDirectory,
  type WorkspaceDirectory
} from '@/lib/workspace-directory'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/workspaces/')({
  // The list itself is the layout route's directory load — possibly empty,
  // never a 404; an empty array renders the empty state below.
  pendingComponent: RoutePending,
  component: WorkspacesRoute,
  head: () => ({ meta: [{ title: pageTitle(m.public_meta_workspaces()) }] })
})

/** The route's thin wrapper: the directory, the session, and where to go next. */
function WorkspacesRoute() {
  const workspaces: WorkspaceDirectory = useWorkspaceDirectory() ?? []
  const session = Route.useRouteContext().session
  const navigate = useNavigate()
  return (
    <WorkspacesPage
      workspaces={workspaces}
      user={session.user}
      onCreated={(workspace) =>
        void navigate({
          to: '/workspaces/$workspaceSlug',
          params: { workspaceSlug: workspace.slug }
        })
      }
    />
  )
}

/**
 * The workspace picker. Props-only so a test renders it without a route tree.
 *
 * Creating a workspace is reachable from both states, not just the empty one:
 * a user who already belongs to a workspace still starts new ones, and the
 * list has no other way in. The empty state keeps the form inline — with no
 * list to read, hiding the one thing to do behind a sheet is a wasted step.
 */
export function WorkspacesPage({
  workspaces,
  user,
  onCreated,
  createWorkspace
}: {
  readonly workspaces: WorkspaceDirectory
  readonly user: {
    readonly role: string
    readonly email: string
    readonly emailVerified: boolean
  }
  readonly onCreated: (workspace: CreatedWorkspace) => void
  /** The form's server-call port, injected by tests. */
  readonly createWorkspace?: CreateWorkspace
}) {
  const formProps = createWorkspace === undefined ? {} : { createWorkspace }
  return (
    <WorkspaceShell viewer={null} systemRole={user.role} workspaceSlug={null}>
      <PageHeader
        title={m.page_workspaces()}
        description={m.page_workspaces_description()}
        {...(workspaces.length === 0
          ? {}
          : {
              actions: (
                <CreateAction title={m.workspaces_new_action()}>
                  <CreateWorkspaceForm onCreated={onCreated} {...formProps} />
                </CreateAction>
              )
            })}
      />
      {/* The unverified state surfaces here rather than gating anything:
          verification is encouraged, not enforced (provider-light rule). */}
      {user.emailVerified ? null : <EmailVerificationBanner email={user.email} />}
      {/* No panel title: the page header already names this list, and a
          second "Your workspaces" heading only lengthens the outline. */}
      <Panel>
        {workspaces.length === 0 ? (
          <div className="grid gap-5">
            {/* Creating is the way in: the creator becomes the workspace's
              first owner, so a fresh account never needs a seed script or
              an existing owner to let them in. */}
            <p className="text-sm text-muted-foreground">
              {m.empty_no_workspace_membership()}
            </p>
            <CreateWorkspaceForm onCreated={onCreated} {...formProps} />
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
