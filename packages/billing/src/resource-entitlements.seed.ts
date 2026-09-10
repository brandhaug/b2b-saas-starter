import { DateTime, Effect, Layer } from 'effect'
import { Billing } from './billing.ts'
import { AuditEventLog, WorkspaceContext } from './ports.ts'
import {
  EMPTY_RESOURCE_SELECTION,
  resourceEntitlement,
  type EntitlementResource,
  type Plan,
  type ResourceSelection
} from './plan-catalog.ts'
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
      function resolveSelection(workspaceId: string, input: ResourceSelection) {
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
      // Admission counts every stored endpoint, including disabled ones, so the
      // fixture refuses and warns on the same ceiling the Live adapter does.
      const summarizeWith = Effect.fn('ResourceEntitlements.summarizeWith')(function* (
        plan: Plan,
        workspaceId: string,
        resource: EntitlementResource,
        selection: ResourceSelection
      ) {
        const eligible = resourceIds(
          inventory.available(workspaceId, DateTime.toEpochMillis(yield* DateTime.now)),
          resource
        )
        let stored = eligible
        if (resource === 'webhook_endpoint') {
          stored = resourceIds(inventory.known(workspaceId), resource)
        }
        return resourceEntitlement(plan, resource, eligible, selection, stored)
      })
      const service: ResourceEntitlementsInterface = {
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
          return yield* summarizeWith(
            yield* billing.currentPlan,
            (yield* WorkspaceContext).workspace.id,
            input.resource,
            yield* service.getSelection()
          )
        }),
        isActiveForWorkspace: Effect.fn('ResourceEntitlements.isActiveForWorkspace')(
          function* (input) {
            return (yield* summarizeWith(
              yield* billing.currentPlanForWorkspace(input.workspaceId),
              input.workspaceId,
              input.resource,
              yield* getSelectionForWorkspace(input.workspaceId)
            )).activeIds.includes(input.resourceId)
          }
        )
      }
      return ResourceEntitlements.of(service)
    })
  ).pipe(Layer.provide(SeedResourceInventoryLayer))
}
