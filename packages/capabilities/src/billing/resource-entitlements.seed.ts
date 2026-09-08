import { DateTime, Effect, Layer } from 'effect'
import { assertWithinPlanLimit } from './resource-admission.ts'
import { Billing } from './billing.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { EMPTY_RESOURCE_SELECTION, resourceEntitlementSummary } from './plan-catalog.ts'
import {
  normalizeSelection,
  validateSelection,
  resourceIds
} from './resource-selection-policy.ts'
import {
  SeedResourceInventory,
  SeedResourceInventoryLayer
} from './resource-inventory.seed.ts'
import {
  ResourceEntitlements,
  type ResourceEntitlementInput,
  type ResourceSelectionInput,
  type ResourceEntitlementsInterface
} from './resource-entitlements.ts'

export function SeedResourceEntitlements() {
  return Layer.effect(
    ResourceEntitlements,
    Effect.gen(function* () {
      const billing = yield* Billing
      const audit = yield* AuditEventLog
      const inventory = yield* SeedResourceInventory
      const lock = inventory.lock
      function resolveSelection(workspaceId: string, input: ResourceSelectionInput) {
        return {
          ...input,
          apiTokenIds: input.apiTokenIds.map((id) =>
            inventory.resolveToken(workspaceId, id)
          )
        }
      }
      const getSelectionForWorkspace = Effect.fn(
        'ResourceEntitlements.getSelectionForWorkspace'
      )(function* (workspaceId: string) {
        return normalizeSelection(
          inventory.selections.get(workspaceId) ?? EMPTY_RESOURCE_SELECTION,
          inventory.available(workspaceId, DateTime.toEpochMillis(yield* DateTime.now))
        )
      })
      const service: ResourceEntitlementsInterface = {
        admitCreation: Effect.fn('ResourceEntitlements.admitCreation')(function* (
          input: ResourceEntitlementInput
        ) {
          const ctx = yield* WorkspaceContext
          const now = DateTime.toEpochMillis(yield* DateTime.now)
          const inventoryRows = inventory.available(ctx.workspace.id, now)
          let used: number
          if (input.resource === 'api_token') {
            used = inventoryRows.apiTokenIds.length
          } else {
            used = inventory.known(ctx.workspace.id).webhookEndpointIds.length
          }
          yield* assertWithinPlanLimit({ ...input, used }).pipe(
            Effect.provideService(Billing, billing)
          )
        }),
        getSelectionForWorkspace,
        getSelection: Effect.fn('ResourceEntitlements.getSelection')(function* () {
          return yield* getSelectionForWorkspace((yield* WorkspaceContext).workspace.id)
        }),
        select: Effect.fn('ResourceEntitlements.select')(function* (input) {
          const ctx = yield* WorkspaceContext
          yield* validateSelection(input, inventory.known(ctx.workspace.id))
          const value = normalizeSelection(
            resolveSelection(ctx.workspace.id, input),
            inventory.available(
              ctx.workspace.id,
              DateTime.toEpochMillis(yield* DateTime.now)
            )
          )
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            actorType: ctx.actorType,
            eventType: 'billing.resource_selection_updated',
            targetType: 'workspace',
            targetId: ctx.workspace.id,
            metadata: {
              apiTokenIds: [...value.apiTokenIds],
              webhookEndpointIds: [...value.webhookEndpointIds]
            }
          })
          inventory.selections.set(
            ctx.workspace.id,
            normalizeSelection(
              resolveSelection(ctx.workspace.id, value),
              inventory.available(
                ctx.workspace.id,
                DateTime.toEpochMillis(yield* DateTime.now)
              )
            )
          )
          return yield* getSelectionForWorkspace(ctx.workspace.id)
        }, lock.withPermits(1)),
        summarize: Effect.fn('ResourceEntitlements.summarize')(function* (input) {
          return resourceEntitlementSummary(
            yield* billing.currentPlan,
            input.resource,
            resourceIds(
              inventory.available(
                (yield* WorkspaceContext).workspace.id,
                DateTime.toEpochMillis(yield* DateTime.now)
              ),
              input.resource
            ),
            yield* service.getSelection()
          )
        }),
        isActive: Effect.fn('ResourceEntitlements.isActive')(function* (input) {
          return (yield* service.summarize(input)).activeIds.includes(input.resourceId)
        }),
        isActiveForWorkspace: Effect.fn('ResourceEntitlements.isActiveForWorkspace')(
          function* (input) {
            return resourceEntitlementSummary(
              yield* billing.currentPlanForWorkspace(input.workspaceId),
              input.resource,
              resourceIds(
                inventory.available(
                  input.workspaceId,
                  DateTime.toEpochMillis(yield* DateTime.now)
                ),
                input.resource
              ),
              yield* getSelectionForWorkspace(input.workspaceId)
            ).activeIds.includes(input.resourceId)
          }
        )
      }
      return ResourceEntitlements.of(service)
    })
  ).pipe(Layer.provide(SeedResourceInventoryLayer))
}
