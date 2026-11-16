import { Context, Effect, Layer, Semaphore } from 'effect'
import { EMPTY_RESOURCE_SELECTION, type ResourceSelection } from './plan-catalog.ts'

/** Current adapter-owned inventories are registered at acquisition, never copied. */
export class SeedResourceInventory extends Context.Service<
  SeedResourceInventory,
  {
    readonly registerTokens: (
      read: (
        workspaceId: WorkspaceId,
        now: number,
        includeUnavailable: boolean
      ) => ReadonlyArray<ApiTokenId>
    ) => void
    readonly registerTokenResolver: (
      read: (workspaceId: WorkspaceId, id: ApiTokenId) => ApiTokenId
    ) => void
    readonly resolveToken: (workspaceId: WorkspaceId, id: ApiTokenId) => ApiTokenId
    readonly registerWebhooks: (
      read: (
        workspaceId: WorkspaceId,
        includeUnavailable: boolean
      ) => ReadonlyArray<WebhookEndpointId>
    ) => void
    readonly available: (workspaceId: WorkspaceId, now: number) => ResourceSelection
    readonly known: (workspaceId: WorkspaceId) => ResourceSelection
    readonly lock: Semaphore.Semaphore
    readonly selections: Map<string, ResourceSelection>
    readonly rotateToken: (
      workspaceId: WorkspaceId,
      fromId: ApiTokenId,
      toId: ApiTokenId
    ) => void
  }
>()('@b2b-saas-starter/billing/SeedResourceInventory') {}

function emptyTokens(
  _workspaceId: WorkspaceId,
  _now: number,
  _includeUnavailable: boolean
): ReadonlyArray<ApiTokenId> {
  return []
}
function unchangedToken(_workspaceId: WorkspaceId, id: ApiTokenId): ApiTokenId {
  return id
}
function emptyWebhooks(
  _workspaceId: WorkspaceId,
  _includeUnavailable: boolean
): ReadonlyArray<WebhookEndpointId> {
  return []
}

export const SeedResourceInventoryLayer = Layer.effect(
  SeedResourceInventory,
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1)
    let tokens = emptyTokens
    let webhooks = emptyWebhooks
    let resolveToken = unchangedToken
    const selections = new Map<string, ResourceSelection>()
    return SeedResourceInventory.of({
      registerTokens: (read) => {
        tokens = read
      },
      registerTokenResolver: (read) => {
        resolveToken = read
      },
      resolveToken: (workspaceId, id) => resolveToken(workspaceId, id),
      registerWebhooks: (read) => {
        webhooks = read
      },
      available: (workspaceId, now) => ({
        apiTokenIds: tokens(workspaceId, now, false),
        webhookEndpointIds: webhooks(workspaceId, false)
      }),
      known: (workspaceId) => ({
        apiTokenIds: tokens(workspaceId, 0, true),
        webhookEndpointIds: webhooks(workspaceId, true)
      }),
      selections,
      lock,
      rotateToken: (workspaceId, fromId, toId) => {
        const current = selections.get(workspaceId) ?? EMPTY_RESOURCE_SELECTION
        selections.set(workspaceId, {
          ...current,
          apiTokenIds: current.apiTokenIds.map((id) => {
            if (id === fromId) {
              return toId
            }
            return id
          })
        })
      }
    })
  })
)
import {
  type ApiTokenId,
  type WebhookEndpointId,
  type WorkspaceId
} from '@b2b-saas-starter/db/ids'
