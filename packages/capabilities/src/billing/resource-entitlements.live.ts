import {
  apiTokens,
  webhookEndpoints,
  workspaceResourceSelections
} from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Layer, Schema } from 'effect'
import { and, count, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { Billing } from './billing.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  EMPTY_RESOURCE_SELECTION,
  ResourceSelection,
  resourceEntitlementSummary
} from './plan-catalog.ts'
import {
  normalizeSelection,
  validateSelection,
  resourceIds
} from './resource-selection-policy.ts'
import { ResourceEntitlements } from './resource-entitlements.ts'
import { assertWithinPlanLimit } from './resource-admission.ts'

const decodeSelection = Schema.decodeUnknownEffect(ResourceSelection)
const encodeIds = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)))
const unavailable = orUnavailable('resource-entitlements')
function eligibleTokenWhere(workspaceId: string, now: string) {
  return and(
    eq(apiTokens.workspaceId, workspaceId),
    isNull(apiTokens.revokedAt),
    isNull(apiTokens.replacedByTokenId),
    or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now))
  )
}
const readSelection = Effect.fn('ResourceSelections.read')(function* (
  workspaceId: string
) {
  const db = yield* Database
  const rows = yield* unavailable(
    db
      .select()
      .from(workspaceResourceSelections)
      .where(eq(workspaceResourceSelections.workspaceId, workspaceId))
      .limit(1)
  )
  return yield* unavailable(decodeSelection(rows[0] ?? EMPTY_RESOURCE_SELECTION))
})

/** Prepared in the selection owner, committed with the token claim and its audit. */
export const prepareTokenSelectionRotation = Effect.fn(
  'ResourceSelections.prepareTokenRotation'
)(function* (workspaceId: string, fromId: string, toId: string, now: string) {
  const db = yield* Database
  yield* readSelection(workspaceId)
  return db
    .update(workspaceResourceSelections)
    .set({
      apiTokenIds: sql`(select json_group_array(case when value = ${fromId} then ${toId} else value end) from json_each(${workspaceResourceSelections.apiTokenIds}))`,
      updatedAt: now
    })
    .where(eq(workspaceResourceSelections.workspaceId, workspaceId))
})

export const LiveResourceEntitlements: Layer.Layer<
  ResourceEntitlements,
  never,
  Database | RawD1 | Billing | AuditEventLog
> = Layer.effect(
  ResourceEntitlements,
  Effect.gen(function* () {
    const db = yield* Database
    const billing = yield* Billing
    const audit = yield* AuditEventLog
    const mutate = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })
    const available = Effect.fn('ResourceSelections.available')(function* (
      workspaceId: string
    ) {
      const now = DateTime.formatIso(yield* DateTime.now)
      const [tokens, endpoints] = yield* Effect.all([
        unavailable(
          db
            .select({ id: apiTokens.id })
            .from(apiTokens)
            .where(eligibleTokenWhere(workspaceId, now))
        ),
        unavailable(
          db
            .select({ id: webhookEndpoints.id })
            .from(webhookEndpoints)
            .where(
              and(
                eq(webhookEndpoints.workspaceId, workspaceId),
                eq(webhookEndpoints.enabled, true)
              )
            )
        )
      ])
      return {
        apiTokenIds: tokens.map((row) => row.id),
        webhookEndpointIds: endpoints.map((row) => row.id)
      }
    })
    const getSelectionForWorkspace = Effect.fn(
      'ResourceEntitlements.getSelectionForWorkspace'
    )(function* (workspaceId: string) {
      return normalizeSelection(
        yield* readSelection(workspaceId).pipe(Effect.provideService(Database, db)),
        yield* available(workspaceId)
      )
    })
    const getSelection = Effect.fn('ResourceEntitlements.getSelection')(function* () {
      return yield* getSelectionForWorkspace((yield* WorkspaceContext).workspace.id)
    })
    const summarizeForWorkspace = Effect.fn(
      'ResourceEntitlements.summarizeForWorkspace'
    )(function* (workspaceId: string, resource: 'api_token' | 'webhook_endpoint') {
      const inventory = yield* available(workspaceId)
      const selected = yield* readSelection(workspaceId).pipe(
        Effect.provideService(Database, db)
      )
      return resourceEntitlementSummary(
        yield* billing.currentPlanForWorkspace(workspaceId),
        resource,
        resourceIds(inventory, resource),
        normalizeSelection(selected, inventory)
      )
    })
    const summarize = Effect.fn('ResourceEntitlements.summarize')(function* (input: {
      readonly resource: 'api_token' | 'webhook_endpoint'
    }) {
      return yield* summarizeForWorkspace(
        (yield* WorkspaceContext).workspace.id,
        input.resource
      )
    })
    return ResourceEntitlements.of({
      admitCreation: Effect.fn('ResourceEntitlements.admitCreation')(function* (input) {
        const workspaceId = (yield* WorkspaceContext).workspace.id
        const now = DateTime.formatIso(yield* DateTime.now)
        let rows
        if (input.resource === 'api_token') {
          rows = yield* unavailable(
            db
              .select({ value: count() })
              .from(apiTokens)
              .where(eligibleTokenWhere(workspaceId, now))
          )
        } else {
          rows = yield* unavailable(
            db
              .select({ value: count() })
              .from(webhookEndpoints)
              .where(eq(webhookEndpoints.workspaceId, workspaceId))
          )
        }
        const used = rows[0]?.value ?? 0
        yield* assertWithinPlanLimit({ ...input, used }).pipe(
          Effect.provideService(Billing, billing)
        )
      }),
      getSelection,
      getSelectionForWorkspace,
      summarize,
      select: Effect.fn('ResourceEntitlements.select')(function* (input) {
        const ctx = yield* WorkspaceContext
        const [knownTokens, knownEndpoints] = yield* Effect.all([
          unavailable(
            db
              .select({ id: apiTokens.id })
              .from(apiTokens)
              .where(eq(apiTokens.workspaceId, ctx.workspace.id))
          ),
          unavailable(
            db
              .select({ id: webhookEndpoints.id })
              .from(webhookEndpoints)
              .where(eq(webhookEndpoints.workspaceId, ctx.workspace.id))
          )
        ])
        yield* validateSelection(input, {
          apiTokenIds: knownTokens.map((row) => row.id),
          webhookEndpointIds: knownEndpoints.map((row) => row.id)
        })
        const now = DateTime.formatIso(yield* DateTime.now)
        // Resolve selected parents to their current leaf at commit time, so an
        // interleaved rotation cannot restore a dead parent or undo another slot.
        const tokenIds = sql`(with recursive selected(id) as (select value from json_each(${encodeIds(input.apiTokenIds)}) union select t.replaced_by_token_id from api_tokens t join selected s on t.id = s.id where t.workspace_id = ${ctx.workspace.id} and t.replaced_by_token_id is not null) select json_group_array(id) from (select distinct t.id from api_tokens t join selected s on t.id = s.id where t.workspace_id = ${ctx.workspace.id} and t.revoked_at is null and t.replaced_by_token_id is null and (t.expires_at is null or t.expires_at > ${now})))`
        const endpointIds = sql`(select json_group_array(id) from webhook_endpoints where workspace_id = ${ctx.workspace.id} and enabled = 1 and id in (select value from json_each(${encodeIds(input.webhookEndpointIds)})))`
        yield* mutate({
          matched: Effect.succeed(true),
          auditEvent: {
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            actorType: ctx.actorType,
            eventType: 'billing.resource_selection_updated',
            targetType: 'workspace',
            targetId: ctx.workspace.id,
            metadata: {
              apiTokenIds: [...input.apiTokenIds],
              webhookEndpointIds: [...input.webhookEndpointIds]
            }
          },
          write: () =>
            db
              .insert(workspaceResourceSelections)
              .values({
                workspaceId: ctx.workspace.id,
                apiTokenIds: tokenIds,
                webhookEndpointIds: endpointIds,
                updatedAt: now
              })
              .onConflictDoUpdate({
                target: workspaceResourceSelections.workspaceId,
                set: {
                  apiTokenIds: tokenIds,
                  webhookEndpointIds: endpointIds,
                  updatedAt: now
                }
              })
        })
        return yield* getSelectionForWorkspace(ctx.workspace.id)
      }),
      isActive: Effect.fn('ResourceEntitlements.isActive')(function* (input) {
        return (yield* summarize(input)).activeIds.includes(input.resourceId)
      }),
      isActiveForWorkspace: Effect.fn('ResourceEntitlements.isActiveForWorkspace')(
        function* (input) {
          return (yield* summarizeForWorkspace(
            input.workspaceId,
            input.resource
          )).activeIds.includes(input.resourceId)
        }
      )
    })
  })
)
