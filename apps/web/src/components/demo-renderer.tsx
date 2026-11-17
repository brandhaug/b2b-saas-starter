import { UserId } from '@b2b-saas-starter/db/ids'
import { WorkspaceDashboardPage } from '@/components/workspace-dashboard-page'
import { WorkspaceMembersPage } from '@/components/workspace-members-page'
import { WorkspaceApiTokensPage } from '@/components/workspace-api-tokens-page'
import { WorkspaceWebhooksPage } from '@/components/workspace-webhooks-page'
import { WorkspaceAuditPage } from '@/components/workspace-audit-page'
import { WorkspaceBillingPage } from '@/components/workspace-billing-page'
import { WorkspaceSettingsPage } from '@/components/workspace-settings-page'
import {
  WorkspaceAssistantPage,
  type AskAssistant
} from '@/components/workspace-assistant-page'
import { LiveNotifications } from '@/components/live-notifications'
import { PageHeader } from '@/components/page/page-header'
import { WorkspaceShell } from '@/components/workspace-shell'
import { PreviewProvider } from '@/components/preview-provider'
import { useState } from 'react'
import {
  demoBillingPorts,
  type DemoDataset,
  type DemoSection
} from '@/lib/demo-fixtures'
import {
  auditFiltersFromSearch,
  auditViewFromSearch,
  type WorkspaceAuditSearchUpdate
} from '@/lib/audit-search'
import { decodeWorkspaceAuditFilters } from '@/lib/server/workspace-audit'
import { applyTableView } from '@/lib/table-view'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { m } from '@b2b-saas-starter/i18n/messages'

function previewAssistantAsk(
  ..._args: Parameters<AskAssistant>
): ReturnType<AskAssistant> {
  // oxlint-disable-next-line effect/noNewPromise -- The browser preview implements the assistant Promise contract.
  return Promise.resolve({
    ok: false,
    reason: 'unavailable',
    message: m.shell_demo_read_only()
  })
}

/** One preview: the dataset's workspace in the chrome, its payloads in the page. */
export function DemoPreviewFrame({
  section,
  dataset
}: {
  readonly section: DemoSection
  readonly dataset: DemoDataset
}) {
  return (
    <PreviewProvider workspace={dataset.workspace}>
      <DemoRenderer section={section} dataset={dataset} />
    </PreviewProvider>
  )
}

function DemoRenderer({
  section,
  dataset
}: {
  readonly section: DemoSection
  readonly dataset: DemoDataset
}) {
  const slug = DEMO_WORKSPACE_SLUG
  const { fixtures } = dataset
  switch (section) {
    case 'overview': {
      return (
        <WorkspaceDashboardPage
          data={fixtures.dashboard}
          ports={{
            listNotifications: dataset.notificationPorts.list,
            markNotificationsRead: dataset.notificationPorts.markRead
          }}
        />
      )
    }
    case 'notifications': {
      return <DemoNotifications dataset={dataset} />
    }
    case 'members': {
      return (
        <WorkspaceMembersPage
          workspaceSlug={slug}
          data={fixtures.members}
          actorUserId={UserId.make('usr_demo')}
        />
      )
    }
    case 'api-tokens': {
      return <WorkspaceApiTokensPage workspaceSlug={slug} data={fixtures.apiTokens} />
    }
    case 'webhooks': {
      return (
        <WorkspaceWebhooksPage
          workspaceSlug={slug}
          data={fixtures.webhooks}
          ports={{ listDeliveryAttempts: dataset.webhookPorts.listAttempts }}
        />
      )
    }
    case 'audit': {
      return <DemoAudit dataset={dataset} />
    }
    case 'billing': {
      return (
        <WorkspaceBillingPage
          workspaceSlug={slug}
          data={fixtures.billing}
          ports={demoBillingPorts}
        />
      )
    }
    case 'settings': {
      return <WorkspaceSettingsPage workspaceSlug={slug} data={fixtures.settings} />
    }
    case 'assistant': {
      return (
        <WorkspaceAssistantPage
          workspaceSlug={slug}
          data={fixtures.assistant}
          ask={previewAssistantAsk}
        />
      )
    }
    default: {
      return unreachable(section)
    }
  }
}

function unreachable(value: never): never {
  return value
}

function DemoNotifications({ dataset }: { readonly dataset: DemoDataset }) {
  return (
    <WorkspaceShell
      workspaceSlug={DEMO_WORKSPACE_SLUG}
      frame={dataset.fixtures.dashboard}
    >
      <PageHeader title={m.notifications_title()} />
      <LiveNotifications
        workspaceSlug={DEMO_WORKSPACE_SLUG}
        fallback={dataset.fixtures.dashboard.notifications}
        listNotifications={dataset.notificationPorts.list}
        markRead={dataset.notificationPorts.markRead}
      />
    </WorkspaceShell>
  )
}

function DemoAudit({ dataset }: { readonly dataset: DemoDataset }) {
  const { auditDetails, fixtures } = dataset
  const [search, setSearch] = useState<WorkspaceAuditSearchUpdate>({})
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const matchingDetailIds = new Set<string>()
  for (const event of auditDetails) {
    if (search.actor !== undefined && event.actorUserId !== search.actor) {
      continue
    }
    if (search.eventType !== undefined && event.eventType !== search.eventType) {
      continue
    }
    if (
      search.since !== undefined &&
      event.createdAt < `${search.since}T00:00:00.000Z`
    ) {
      continue
    }
    if (
      search.until !== undefined &&
      event.createdAt > `${search.until}T23:59:59.999Z`
    ) {
      continue
    }
    matchingDetailIds.add(event.id)
  }
  const view = auditViewFromSearch(search.view)
  const events = applyTableView(
    fixtures.audit.events.filter((event) => matchingDetailIds.has(event.id)),
    view,
    (event, field) => {
      if (field === 'actorUserId') {
        return (
          auditDetails.find((detail) => detail.id === event.id)?.actorUserId ?? null
        )
      }
      if (field === 'actorType') {
        return event.actorType
      }
      if (field === 'eventType') {
        return event.eventType
      }
      return event.createdAt
    }
  )
  const selectedEvent =
    selectedEventId === null
      ? null
      : (auditDetails.find((event) => event.id === selectedEventId) ?? null)
  const filters = decodeWorkspaceAuditFilters(auditFiltersFromSearch(search))
  return (
    <WorkspaceAuditPage
      workspaceSlug={DEMO_WORKSPACE_SLUG}
      data={{
        ...fixtures.audit,
        events,
        filters,
        selectedEvent,
        view
      }}
      applySearch={setSearch}
      selectedEventId={selectedEventId}
      closeEvent={() => setSelectedEventId(null)}
      onOpenEvent={(event) => setSelectedEventId(event.id)}
    />
  )
}
