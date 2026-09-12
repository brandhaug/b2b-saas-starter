import { SectionTabs } from '@/components/page/section-tabs'
import { WorkspaceLink } from '@/components/workspace-link'
import { InvitationPanel } from '@/components/invitation-panel'
import { EmailDeliveryPanel } from '@/components/email-delivery-panel'
import { MembersPanel } from '@/components/members-panel'
import { InviteMemberForm } from '@/components/invite-member-form'
import { PageHeader } from '@/components/page/page-header'
import { CreateAction } from '@/components/page/panel'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { type WorkspaceMembersPayload } from '@/lib/server/workspace-members'
import { viewerCan } from '@/lib/permissions'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The workspace roster page. Lives beside the route file (not in it) so the
 * route module stays a thin shell the router's code splitting can reduce to
 * `createFileRoute` + lazy segments — an exported page in a route file pins
 * its whole import graph into the route tree every page preloads.
 *
 * Takes its params and payload as props so a test renders it without a route
 * tree.
 */
export function WorkspaceMembersPage({
  workspaceSlug,
  data,
  systemRole,
  actorUserId
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceMembersPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
  /** The signed-in user's id — the roster's own-row verb (leave) keys on it. */
  readonly actorUserId: string
}) {
  const { viewer, unreadCount, members, invitations, seatUsage } = data
  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      unreadCount={unreadCount}
      viewer={viewer}
      layout="wide"
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title={m.nav_members()}
        description={m.page_members_description()}
        actions={
          viewerCan(viewer, { invitation: ['create'] }) ? (
            <CreateAction action="invite" title={m.form_invite_member()}>
              <InviteMemberForm workspaceSlug={workspaceSlug} />
            </CreateAction>
          ) : null
        }
      />
      {/* The seat half of the plan gate, as a prompt rather than a refusal:
          the workspace may always add Members, but a flat plan past its
          included seats asks for an upgrade here. */}
      {seatUsage.overLimit ? (
        <Alert>
          <AlertDescription>
            {m.members_seat_limit({
              used: seatUsage.used,
              included: seatUsage.included ?? 0
            })}{' '}
            <WorkspaceLink
              to="/workspaces/$workspaceSlug/billing"
              workspaceSlug={workspaceSlug}
              className="font-medium text-foreground underline underline-offset-4"
            >
              {m.upgrade_plan_to_cover_team()}
            </WorkspaceLink>
          </AlertDescription>
        </Alert>
      ) : null}
      <SectionTabs
        defaultValue="members"
        sections={[
          {
            value: 'members',
            label: m.nav_members(),
            content: (
              <div className="grid gap-6">
                <MembersPanel
                  workspaceSlug={workspaceSlug}
                  members={members}
                  viewer={viewer}
                  actorUserId={actorUserId}
                />
              </div>
            )
          },
          ...(invitations === null
            ? []
            : [
                {
                  value: 'invitations',
                  label: m.pending_invitations(),
                  content: (
                    <InvitationPanel
                      workspaceSlug={workspaceSlug}
                      viewer={viewer}
                      invitations={invitations}
                      emailDeliveries={data.emailDeliveries ?? []}
                    />
                  )
                }
              ]),
          ...(data.emailDeliveries === null
            ? []
            : [
                {
                  value: 'delivery',
                  label: m.email_delivery_title(),
                  content: <EmailDeliveryPanel records={data.emailDeliveries} />
                }
              ])
        ]}
      />
    </WorkspaceShell>
  )
}
