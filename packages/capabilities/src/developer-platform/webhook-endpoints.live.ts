import { WebhookDeliveryId, WebhookEndpointId } from '@b2b-saas-starter/db/ids'
import { type RawD1, type Database } from '@b2b-saas-starter/db/service'
import { type JsonObject, type JsonValue } from '@b2b-saas-starter/db/schema/json'
import { webhookEndpoints } from '@b2b-saas-starter/db/schema/developer-platform'
import { DateTime, Effect, Layer, Redacted } from 'effect'
import { and, asc, eq, sql, type SQL } from 'drizzle-orm'

import {
  WorkspaceContext as BillingWorkspaceContext,
  workspaceAuditAttribution
} from '@b2b-saas-starter/billing/ports'
import { Billing } from '@b2b-saas-starter/billing/billing'
import { prepareResourceAdmission } from '@b2b-saas-starter/billing/resource-admission'
import { type AuditEventLog } from '../governance/audit-event-log.ts'
import { planPendingDispatch, planSecretRotation } from './webhook-delivery-plan.ts'
import {
  ensureValidWebhookUrl,
  type UpdateWebhookEndpointInput,
  WEBHOOK_TEST_EVENT_TYPE,
  WebhookDispatchRejected,
  WebhookEndpointNotFound,
  WebhookEndpoints,
  type WebhookEndpoint
} from './webhook-endpoints.ts'
import { randomWebhookSecret } from '../crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { clampPageLimit, cutKeysetPage } from '../internal/keyset-cursor.ts'
import { keysetResume } from '../internal/keyset-query.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
import {
  makeLiveWebhookStorage,
  projectionFromAggregate,
  scopedEndpointWhere
} from './webhook-storage.live.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const LiveWebhookEndpoints: Layer.Layer<
  WebhookEndpoints,
  never,
  Database | RawD1 | Billing | AuditEventLog | WebhookPublisher
> = Layer.effect(WebhookEndpoints)(
  Effect.gen(function* () {
    const billing = yield* Billing
    const publisher = yield* WebhookPublisher
    const {
      db,
      unavailable,
      auditedMutation,
      endpointExists,
      endpointRow,
      aggregateQuery,
      endpointProjection,
      recordOperatorDispatch
    } = yield* makeLiveWebhookStorage('webhook-endpoints')

    return {
      list: Effect.fn('WebhookEndpoints.list')(function* () {
        const ctx = yield* WorkspaceContext
        const rows = yield* unavailable(
          aggregateQuery()
            .where(eq(webhookEndpoints.workspaceId, ctx.workspace.id))
            .groupBy(webhookEndpoints.id)
        )
        return rows.map(projectionFromAggregate)
      })(),
      listPage: Effect.fn('WebhookEndpoints.listPage')(function* (input) {
        const ctx = yield* WorkspaceContext
        const limit = clampPageLimit(input?.limit)
        const conditions: Array<SQL> = [
          eq(webhookEndpoints.workspaceId, ctx.workspace.id)
        ]
        // No timestamp on this projection; resume in stable id order.
        const resume = keysetResume(
          'asc',
          { key: webhookEndpoints.id, id: webhookEndpoints.id },
          input?.cursor
        )
        if (resume.kind === 'empty') {
          return { items: [], nextCursor: null }
        }
        if (resume.kind === 'resume') {
          conditions.push(resume.condition)
        }
        const rows = yield* unavailable(
          aggregateQuery()
            .where(and(...conditions))
            .groupBy(webhookEndpoints.id)
            .orderBy(asc(webhookEndpoints.id))
            .limit(limit + 1)
        )
        return cutKeysetPage(rows.map(projectionFromAggregate), limit, (endpoint) => ({
          key: endpoint.id,
          id: endpoint.id
        }))
      }),
      create: Effect.fn('WebhookEndpoints.create')(function* (input) {
        yield* ensureValidWebhookUrl(input.url)
        const ctx = yield* WorkspaceContext
        const admission = yield* prepareResourceAdmission('webhook_endpoint').pipe(
          Effect.provideService(Billing, billing),
          Effect.provideService(BillingWorkspaceContext, ctx)
        )
        const signingSecret = randomWebhookSecret()
        const createdAt = yield* DateTime.now
        const endpoint = {
          id: yield* newCapabilityId('wh').pipe(
            Effect.map((id) => WebhookEndpointId.make(id))
          ),
          workspaceId: ctx.workspace.id,
          url: input.url,
          description: input.description,
          signingSecret,
          enabled: true,
          // Subscriptions stay free-text on the wire and at rest so producers
          // can grow without a migration — the column type matches.
          events: [...input.events],
          createdAt: DateTime.formatIso(createdAt)
        }
        // The insert evaluates admission in the same batch as its audit.
        const created = yield* auditedMutation({
          matched: Effect.succeed(true),
          auditEvent: {
            ...workspaceAuditAttribution(ctx),
            eventType: 'webhook_endpoint.created',
            targetType: 'webhook_endpoint',
            targetId: endpoint.id,
            metadata: { url: input.url, events: input.events }
          },
          write: () => [
            db.insert(webhookEndpoints).select(
              db
                .select({
                  id: sql<string>`${endpoint.id}`.as('id'),
                  workspaceId: sql<string>`${endpoint.workspaceId}`.as('workspaceId'),
                  url: sql<string>`${endpoint.url}`.as('url'),
                  description: sql<string | null>`${endpoint.description ?? null}`.as(
                    'description'
                  ),
                  signingSecret: sql<string>`${signingSecret}`.as('signingSecret'),
                  previousSigningSecret: sql<string | null>`null`.as(
                    'previousSigningSecret'
                  ),
                  previousSecretExpiresAt: sql<string | null>`null`.as(
                    'previousSecretExpiresAt'
                  ),
                  enabled: sql<boolean>`1`.as('enabled'),
                  consecutiveFailures: sql<number>`0`.as('consecutiveFailures'),
                  events:
                    sql`${sql.param(endpoint.events, webhookEndpoints.events)}`.as(
                      'events'
                    ),
                  createdAt: sql<string>`${endpoint.createdAt}`.as('createdAt')
                })
                .from(sql`(select 1)`)
                .where(admission.condition)
            )
          ]
        })
        if (!created) {
          return yield* Effect.fail(admission.rejected)
        }
        // Publish only the projection, never the signing secret.
        yield* publishWebhookEventWith(publisher, {
          eventType: 'webhook_endpoint.created',
          payload: toEndpointProjection(endpoint)
        })
        return {
          endpoint: toEndpointProjection(endpoint),
          signingSecret: Redacted.make(signingSecret)
        }
      }),
      update: Effect.fn('WebhookEndpoints.update')(function* (input) {
        if (input.url !== undefined) {
          yield* ensureValidWebhookUrl(input.url)
        }
        const ctx = yield* WorkspaceContext
        const patch: UpdateWebhookEndpointInput = {
          endpointId: input.endpointId
        }
        if (input.url !== undefined) {
          patch.url = input.url
        }
        if (input.events !== undefined) {
          patch.events = [...input.events]
        }
        if (input.enabled !== undefined) {
          patch.enabled = input.enabled
        }
        const applied = yield* auditedMutation({
          matched: endpointExists(input.endpointId, ctx.workspace.id),
          auditEvent: {
            ...workspaceAuditAttribution(ctx),
            eventType: 'webhook_endpoint.updated',
            targetType: 'webhook_endpoint',
            targetId: input.endpointId,
            metadata: updateMetadata(input)
          },
          write: () => [
            db
              .update(webhookEndpoints)
              .set(patch)
              .where(scopedEndpointWhere(input.endpointId, ctx.workspace.id))
          ]
        })
        if (!applied) {
          return yield* Effect.fail(
            new WebhookEndpointNotFound({ endpointId: input.endpointId })
          )
        }
        const projection = yield* endpointProjection(input.endpointId, ctx.workspace.id)
        if (projection === null) {
          // Another request deleted the endpoint after the committed update.
          return yield* Effect.fail(
            new WebhookEndpointNotFound({ endpointId: input.endpointId })
          )
        }
        return projection
      }),
      delete: Effect.fn('WebhookEndpoints.delete')(function* (input) {
        const ctx = yield* WorkspaceContext
        // Read first so the audit metadata can name what was removed; the
        // deliveries cascade with the endpoint row (FK `onDelete`).
        const endpoint = yield* endpointRow(input.endpointId, ctx.workspace.id)
        if (!endpoint) {
          return yield* Effect.fail(
            new WebhookEndpointNotFound({ endpointId: input.endpointId })
          )
        }
        const applied = yield* auditedMutation({
          matched: Effect.succeed(true),
          auditEvent: {
            ...workspaceAuditAttribution(ctx),
            eventType: 'webhook_endpoint.deleted',
            targetType: 'webhook_endpoint',
            targetId: input.endpointId,
            metadata: { url: endpoint.url }
          },
          write: () => [
            db
              .delete(webhookEndpoints)
              .where(scopedEndpointWhere(input.endpointId, ctx.workspace.id))
          ]
        })
        if (!applied) {
          return yield* Effect.fail(
            new WebhookEndpointNotFound({ endpointId: input.endpointId })
          )
        }
      }),
      sendTestEvent: Effect.fn('WebhookEndpoints.sendTestEvent')(function* (input) {
        const ctx = yield* WorkspaceContext
        const endpoint = yield* endpointRow(input.endpointId, ctx.workspace.id)
        if (!endpoint) {
          return yield* Effect.fail(
            new WebhookEndpointNotFound({ endpointId: input.endpointId })
          )
        }
        if (!endpoint.enabled) {
          return yield* Effect.fail(
            new WebhookDispatchRejected({ reason: 'endpoint is disabled' })
          )
        }
        const now = yield* DateTime.now
        const payload = { test: true, sentAt: DateTime.formatIso(now) }
        const deliveryId = yield* newCapabilityId('whd').pipe(
          Effect.map((id) => WebhookDeliveryId.make(id))
        )
        // No audit event: a test send is operator tooling, not a
        // security-relevant mutation — the delivery row itself is the record.
        yield* recordOperatorDispatch({
          deliveryId,
          workspaceId: ctx.workspace.id,
          plan: planPendingDispatch({
            endpointId: endpoint.id,
            eventType: WEBHOOK_TEST_EVENT_TYPE,
            payload
          })
        })
        yield* publisher.enqueue({
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: WEBHOOK_TEST_EVENT_TYPE,
          deliveryId,
          payload
        })
        return { deliveryId }
      }),
      rotateSecret: Effect.fn('WebhookEndpoints.rotateSecret')(function* (input) {
        const ctx = yield* WorkspaceContext
        // Reject missing endpoints before minting a replacement. The SQL
        // update moves the current secret into its grace window atomically.
        const endpoint = yield* endpointRow(input.endpointId, ctx.workspace.id)
        if (!endpoint) {
          return yield* Effect.fail(
            new WebhookEndpointNotFound({ endpointId: input.endpointId })
          )
        }
        const rotatedAt = yield* DateTime.now
        const expiresAt = planSecretRotation(rotatedAt)
        // Return the replacement secret only if the update commits.
        let signingSecret = ''
        const applied = yield* auditedMutation({
          matched: Effect.succeed(true),
          auditEvent: {
            ...workspaceAuditAttribution(ctx),
            eventType: 'webhook_endpoint.secret_rotated',
            targetType: 'webhook_endpoint',
            targetId: input.endpointId,
            metadata: { previousSecretExpiresAt: expiresAt }
          },
          write: () => {
            signingSecret = randomWebhookSecret()
            return [
              db
                .update(webhookEndpoints)
                .set({
                  signingSecret,
                  previousSigningSecret: sql`${webhookEndpoints.signingSecret}`,
                  previousSecretExpiresAt: expiresAt
                })
                .where(scopedEndpointWhere(input.endpointId, ctx.workspace.id))
            ]
          }
        })
        if (!applied) {
          return yield* Effect.fail(
            new WebhookEndpointNotFound({ endpointId: input.endpointId })
          )
        }
        return { signingSecret: Redacted.make(signingSecret) }
      })
    }
  })
)

// Audit only fields supplied by the caller; omit absent fields.
function updateMetadata(input: {
  readonly url?: string | undefined
  readonly events?: ReadonlyArray<string> | undefined
  readonly enabled?: boolean | undefined
}): JsonObject {
  const metadata: Record<string, JsonValue> = {}
  if (input.url !== undefined) {
    metadata.url = input.url
  }
  if (input.events !== undefined) {
    metadata.events = [...input.events]
  }
  if (input.enabled !== undefined) {
    metadata.enabled = input.enabled
  }
  return metadata
}

function toEndpointProjection(endpoint: {
  readonly id: WebhookEndpointId
  readonly url: string
  readonly enabled: boolean
  readonly events: ReadonlyArray<string>
}): WebhookEndpoint {
  return {
    id: endpoint.id,
    url: endpoint.url,
    enabled: endpoint.enabled,
    events: [...endpoint.events],
    successRate: 100
  }
}
