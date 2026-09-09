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
import { useState } from 'react'
import {
  demoAuditDetails,
  demoFixtures,
  demoNotificationPorts,
  demoWebhookPorts,
  type DemoSection
} from '@/lib/demo-fixtures'
import { type WorkspaceAuditSearchUpdate } from '@/lib/audit-search'
import { type WorkspaceAuditPayload } from '@/lib/server/workspace-audit'
import { m } from '@b2b-saas-starter/i18n/messages'

// oxlint-disable-next-line typescript/require-await -- preview refusal implements the assistant's promise contract without I/O
async function previewAssistantAsk(
  ..._args: Parameters<AskAssistant>
): ReturnType<AskAssistant> {
  return { ok: false, reason: 'unavailable', message: m.shell_demo_read_only() }
}

export function DemoRenderer({ section }: { readonly section: DemoSection }) {
  const slug = 'starter-lab'
  switch (section) {
    case 'overview': {
      return (
        <WorkspaceDashboardPage
          data={demoFixtures.dashboard}
          ports={{
            listNotifications: demoNotificationPorts.list,
            markNotificationsRead: demoNotificationPorts.markRead
          }}
        />
      )
    }
    case 'notifications': {
      return <DemoNotifications />
    }
    case 'members': {
      return (
        <WorkspaceMembersPage
          workspaceSlug={slug}
          data={demoFixtures.members}
          actorUserId="usr_demo"
        />
      )
    }
    case 'api-tokens': {
      return (
        <WorkspaceApiTokensPage workspaceSlug={slug} data={demoFixtures.apiTokens} />
      )
    }
    case 'webhooks': {
      return (
        <WorkspaceWebhooksPage
          workspaceSlug={slug}
          data={demoFixtures.webhooks}
          ports={{ listDeliveryAttempts: demoWebhookPorts.listAttempts }}
        />
      )
    }
    case 'audit': {
      return <DemoAudit />
    }
    case 'billing': {
      return <WorkspaceBillingPage workspaceSlug={slug} data={demoFixtures.billing} />
    }
    case 'settings': {
      return <WorkspaceSettingsPage workspaceSlug={slug} data={demoFixtures.settings} />
    }
    case 'assistant': {
      return (
        <WorkspaceAssistantPage
          workspaceSlug={slug}
          data={demoFixtures.assistant}
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

function DemoNotifications() {
  return (
    <WorkspaceShell
      workspaceSlug="starter-lab"
      unreadCount={demoFixtures.dashboard.unreadCount}
      viewer={demoFixtures.dashboard.viewer}
    >
      <PageHeader title={m.notifications_title()} />
      <LiveNotifications
        workspaceSlug="starter-lab"
        fallback={demoFixtures.dashboard.notifications}
        listNotifications={demoNotificationPorts.list}
        markRead={demoNotificationPorts.markRead}
      />
    </WorkspaceShell>
  )
}

function DemoAudit() {
  const [search, setSearch] = useState<WorkspaceAuditSearchUpdate>({})
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const matchingDetailIds = new Set<string>()
  for (const event of demoAuditDetails) {
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
  const events = demoFixtures.audit.events.filter((event) =>
    matchingDetailIds.has(event.id)
  )
  const selectedEvent =
    selectedEventId === null
      ? null
      : (demoAuditDetails.find((event) => event.id === selectedEventId) ?? null)
  const filters: WorkspaceAuditPayload['filters'] = {}
  if (search.actor !== undefined) {
    filters.actorUserId = search.actor
  }
  if (search.eventType !== undefined) {
    filters.eventType = search.eventType
  }
  if (search.since !== undefined) {
    filters.since = search.since
  }
  if (search.until !== undefined) {
    filters.until = search.until
  }
  return (
    <WorkspaceAuditPage
      workspaceSlug="starter-lab"
      data={{ ...demoFixtures.audit, events, filters, selectedEvent }}
      applySearch={setSearch}
      selectedEventId={selectedEventId}
      closeEvent={() => setSelectedEventId(null)}
      onOpenEvent={(event) => setSelectedEventId(event.id)}
    />
  )
}
