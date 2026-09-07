import { Effect } from 'effect'
import { ResourceSelectionRejected } from './errors.ts'
import { limitFor, STARTER_PLAN, type ResourceSelection } from './plan-catalog.ts'

export function normalizeSelection(
  selection: ResourceSelection,
  available: ResourceSelection
): ResourceSelection {
  const tokens = new Set(available.apiTokenIds)
  const webhooks = new Set(available.webhookEndpointIds)
  return {
    apiTokenIds: [...new Set(selection.apiTokenIds)].filter((id) => tokens.has(id)),
    webhookEndpointIds: [...new Set(selection.webhookEndpointIds)].filter((id) =>
      webhooks.has(id)
    )
  }
}

export const validateSelection = Effect.fn('ResourceSelection.validate')(function* (
  selection: ResourceSelection,
  known: ResourceSelection
) {
  const categories: ReadonlyArray<
    readonly ['api_token' | 'webhook_endpoint', ReadonlyArray<string>]
  > = [
    ['api_token', selection.apiTokenIds],
    ['webhook_endpoint', selection.webhookEndpointIds]
  ]
  for (const [resource, ids] of categories) {
    const knownIds = new Set(resourceIds(known, resource))
    if (ids.some((id) => !knownIds.has(id))) {
      return yield* Effect.fail(
        new ResourceSelectionRejected({
          resource,
          reason: 'selection_unknown_resource'
        })
      )
    }
    const limit = limitFor(STARTER_PLAN, resource)
    if (limit !== null && new Set(ids).size > limit) {
      return yield* Effect.fail(
        new ResourceSelectionRejected({ resource, reason: 'selection_exceeds_limit' })
      )
    }
  }
})

export function resourceIds(
  inventory: ResourceSelection,
  resource: 'api_token' | 'webhook_endpoint'
): ReadonlyArray<string> {
  if (resource === 'api_token') {
    return inventory.apiTokenIds
  }
  return inventory.webhookEndpointIds
}
