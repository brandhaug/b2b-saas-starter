import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { auditActorTypeLabel, auditEventLabel } from '@/lib/audit-labels'
import { formatDateTime } from '@/lib/format-date'
import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { m } from '@b2b-saas-starter/i18n/messages'

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
        title: m.attention_pending_title({ count: pending }),
        description: m.attention_pending_description(),
        to: '/workspaces/$workspaceSlug/members',
        linkLabel: m.attention_review_invitations()
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
        title: m.attention_unused_title({ count: neverUsed }),
        description: m.attention_unused_description(),
        to: '/workspaces/$workspaceSlug/api-tokens',
        linkLabel: m.attention_review_tokens()
      })
    }
  }

  if (webhooks !== null) {
    for (const endpoint of webhooks) {
      if (endpoint.enabled && endpoint.successRate < SUCCESS_RATE_THRESHOLD) {
        items.push({
          id: `endpoint-${endpoint.id}`,
          severity: 'warn',
          title: m.attention_endpoint_title({ rate: endpoint.successRate }),
          description: m.attention_endpoint_description({
            url: endpoint.url,
            threshold: SUCCESS_RATE_THRESHOLD
          }),
          to: '/workspaces/$workspaceSlug/webhooks',
          linkLabel: m.attention_inspect_deliveries()
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
        description: m.attention_audit_description({
          actor: event.actor,
          type: auditActorTypeLabel(event.actorType),
          time: formatDateTime(event.createdAt)
        }),
        to: '/workspaces/$workspaceSlug/audit',
        linkLabel: m.attention_open_audit()
      })
    }
  }

  return items
}
