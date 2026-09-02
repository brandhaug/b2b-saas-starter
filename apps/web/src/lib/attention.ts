import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { auditEventLabel } from '@/lib/audit-labels'
import { formatDateTime } from '@/lib/format-date'
import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'

/**
 * The dashboard's attention feed derivation: one ordered list of what an owner
 * should act on, computed from the segments the dashboard loader already read.
 * Each `null` segment simply contributes nothing — a member sees no attention
 * items because their payload carries no readable segments.
 */
export type AttentionItem = {
  readonly id: string
  readonly severity: 'warn' | 'info'
  readonly title: string
  readonly description: string
  readonly to:
    | '/workspaces/$workspaceSlug/members'
    | '/workspaces/$workspaceSlug/api-tokens'
    | '/workspaces/$workspaceSlug/webhooks'
    | '/workspaces/$workspaceSlug/audit'
  /** The link's accessible tail, e.g. "Review invitations". */
  readonly linkLabel: string
}

/** An endpoint below this success rate is an attention item. */
const SUCCESS_RATE_THRESHOLD = 95

export function attentionItems({
  invitations,
  apiTokens,
  webhooks,
  auditEvents
}: {
  readonly invitations: ReadonlyArray<Invitation> | null
  readonly apiTokens: ReadonlyArray<ApiToken> | null
  readonly webhooks: ReadonlyArray<WebhookEndpoint> | null
  readonly auditEvents: ReadonlyArray<AuditEvent> | null
}): Array<AttentionItem> {
  const items: Array<AttentionItem> = []

  if (invitations !== null) {
    let pending = 0
    for (const invitation of invitations) {
      if (invitation.status === 'pending') {
        pending += 1
      }
    }
    if (pending > 0) {
      items.push({
        id: 'pending-invitations',
        severity: 'warn',
        title: `${pending} pending invitation${pending === 1 ? '' : 's'}`,
        description: 'They join once they open the link and accept.',
        to: '/workspaces/$workspaceSlug/members',
        linkLabel: 'Review invitations'
      })
    }
  }

  if (apiTokens !== null) {
    let neverUsed = 0
    for (const token of apiTokens) {
      if (token.lastUsedAt === null) {
        neverUsed += 1
      }
    }
    if (neverUsed > 0) {
      items.push({
        id: 'unused-tokens',
        severity: 'info',
        title: `${neverUsed} token${neverUsed === 1 ? '' : 's'} minted but never used`,
        description: 'A token that has never authenticated may be stray.',
        to: '/workspaces/$workspaceSlug/api-tokens',
        linkLabel: 'Review tokens'
      })
    }
  }

  if (webhooks !== null) {
    for (const endpoint of webhooks) {
      if (endpoint.enabled && endpoint.successRate < SUCCESS_RATE_THRESHOLD) {
        items.push({
          id: `endpoint-${endpoint.id}`,
          severity: 'warn',
          title: `Endpoint at ${endpoint.successRate}% success`,
          description: `${endpoint.url} is under the ${SUCCESS_RATE_THRESHOLD}% threshold.`,
          to: '/workspaces/$workspaceSlug/webhooks',
          linkLabel: 'Inspect deliveries'
        })
      }
    }
  }

  if (auditEvents !== null) {
    // Only the tail of the trail: the feed names what just happened, the audit
    // page owns the history.
    for (const event of auditEvents.slice(0, 3)) {
      items.push({
        id: `event-${event.id}`,
        severity: 'info',
        title: auditEventLabel(event.eventType),
        description: `${event.actor} · ${formatDateTime(event.createdAt)} UTC`,
        to: '/workspaces/$workspaceSlug/audit',
        linkLabel: 'Open the audit trail'
      })
    }
  }

  return items
}
