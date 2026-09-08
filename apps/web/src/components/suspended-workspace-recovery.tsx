import { ExternalLinkIcon } from 'lucide-react'

import { ApiTokensPanel } from '@/components/api-tokens-panel'
import { ActionFeedback } from '@/components/page/action-feedback'
import { PageHeader } from '@/components/page/page-header'
import { Panel } from '@/components/page/panel'
import { SsoPanel } from '@/components/sso-panel'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useServerAction } from '@/hooks/use-server-action'
import { startPortalSessionServerFn } from '@/lib/server/billing'
import { type WorkspaceRecoveryPayload } from '@/lib/server/workspace-suspension'
import { m } from '@b2b-saas-starter/i18n/messages'

export function SuspendedWorkspaceRecovery({
  workspaceSlug,
  data,
  systemRole
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceRecoveryPayload
  readonly systemRole?: string | null
}) {
  const portal = useServerAction<undefined, { url: string }>(
    () => startPortalSessionServerFn({ data: { workspaceSlug } }),
    {
      failureMessage: m.portal_failed(),
      invalidate: false,
      onSuccess: ({ url }) => window.location.assign(url)
    }
  )
  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      viewer={data.viewer}
    >
      <PageHeader
        title={m.workspace_suspended_title({ workspace: data.workspaceName })}
        description={
          data.canViewExplanation
            ? m.workspace_suspended_description()
            : m.workspace_suspended_member_notice()
        }
      />
      {data.canViewExplanation ? (
        <Panel title={m.workspace_suspended_explanation_title()}>
          <p className="text-sm leading-6">
            {data.customerExplanation ?? m.workspace_suspended_description()}
          </p>
        </Panel>
      ) : null}
      {data.canManageBilling ? (
        <Panel
          title={m.workspace_suspended_recovery_title()}
          description={m.workspace_suspended_recovery_description()}
          actions={
            data.billingConfigured ? (
              <Button
                variant="secondary"
                disabled={portal.pending}
                onClick={() => portal.run(undefined)}
              >
                {portal.pending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <ExternalLinkIcon />
                )}
                {m.workspace_suspended_billing()}
              </Button>
            ) : null
          }
        >
          <p className="text-sm text-muted-foreground">
            {m.workspace_suspended_support_guidance()}
          </p>
          <ActionFeedback error={portal.error} />
        </Panel>
      ) : null}
      {data.apiTokens === null ? null : (
        <ApiTokensPanel
          workspaceSlug={workspaceSlug}
          tokens={data.apiTokens}
          viewer={data.viewer}
          creation="hidden"
        />
      )}
      {data.ssoConnections === null ? null : (
        <Panel title={m.workspace_suspended_sso()}>
          <SsoPanel
            workspaceSlug={workspaceSlug}
            connections={data.ssoConnections}
            viewer={data.viewer}
          />
        </Panel>
      )}
    </WorkspaceShell>
  )
}
