import {
  type WebhookDeliveryId,
  type WebhookEndpointId,
  type WorkspaceId
} from '@b2b-saas-starter/db/ids'
import {
  SeedResourceInventory,
  SeedResourceInventoryLayer
} from '@b2b-saas-starter/billing/resource-inventory.seed'
import { Context, Effect, Layer } from 'effect'
import {
  deliveredDeliveryStatus,
  deliverySuccessRate,
  type Json,
  type SeedWebhookDeliveryFixture,
  type WebhookDeliveryAttempt,
  type WebhookDeliveryStatus
} from './webhook-delivery-plan.ts'
import { type WebhookEndpoint } from './webhook-endpoints.ts'
import { seedWorkspaceRecord } from '../seed-fixture.ts'
import { type Workspace } from '../governance/workspace-identity.ts'

/**
 * A Seed fixture row: the wire projection plus the storage columns the
 * projection deliberately hides but the delivery path needs (the plaintext
 * signing secret `getDispatchTarget` hands the worker, and the owning
 * workspace so cross-workspace messages resolve `null` like Live). Absent
 * fields take fixed fixture defaults.
 */
export type SeedWebhookEndpointFixture = {
  readonly id: WebhookEndpointId
  readonly url: string
  readonly enabled: boolean
  readonly events: ReadonlyArray<string>
  readonly signingSecret?: string
  readonly workspaceId?: WorkspaceId
}

/** Persisted deliveries may lack an attempt time, including terminal rows. */
export type SeedDeliveryFixture = Omit<SeedWebhookDeliveryFixture, 'lastAttemptAt'> & {
  readonly lastAttemptAt: string | null
}

export type SeedEndpointRow = {
  readonly id: WebhookEndpointId
  readonly workspaceId: WorkspaceId
  url: string
  enabled: boolean
  events: ReadonlyArray<string>
  signingSecret: string
  previousSigningSecret: string | null
  previousSecretExpiresAt: string | null
  // The failure ladder's streak, moved in the same step as the delivery row
  // (see `recordAttempt`) so the Seed store mirrors the Live batch.
  consecutiveFailures: number
}

export type SeedDeliveryRow = {
  readonly id: WebhookDeliveryId
  readonly endpointId: WebhookEndpointId
  readonly workspaceId: WorkspaceId
  readonly eventType: string
  readonly status: WebhookDeliveryStatus
  readonly attempts: number
  readonly lastAttemptAt: string | null
  readonly nextAttemptAt: string | null
  readonly responseStatus: number | null
  readonly payload: Json
  readonly requestHeaders: Record<string, string> | null
  readonly responseBody: string | null
  readonly replayedFrom: WebhookDeliveryId | null
}

/**
 * The one in-memory store the Seed webhook services share, standing in for
 * the D1 tables their Live adapters share: deleting an endpoint must cascade
 * the deliveries the history service reads, and a replay must reserve the row
 * the dispatch service resolves.
 */
type SeedWebhookStoreInterface = {
  readonly endpoints: Array<SeedEndpointRow>
  readonly deliveries: Array<SeedDeliveryRow>
  readonly attempts: Array<WebhookDeliveryAttempt>
  /** The workspace catalog the cross-workspace admin read joins against. */
  readonly workspaces: ReadonlyArray<Workspace>
  /** Destinations an investigation approved, keyed by replay delivery id. */
  readonly approvedDestinations: Map<string, string>
  readonly inventory: SeedResourceInventory['Service']
  readonly endpointFor: (
    endpointId: WebhookEndpointId,
    workspaceId: WorkspaceId
  ) => SeedEndpointRow | null
  readonly projection: (endpoint: SeedEndpointRow) => WebhookEndpoint
}

export class SeedWebhookStore extends Context.Service<
  SeedWebhookStore,
  SeedWebhookStoreInterface
>()('@b2b-saas-starter/capabilities/SeedWebhookStore') {}

export function SeedWebhookStoreLayer(
  seedFixtures: ReadonlyArray<SeedWebhookEndpointFixture>,
  seedDeliveries: ReadonlyArray<SeedDeliveryFixture> = [],
  seedWorkspaces: ReadonlyArray<Workspace> = [seedWorkspaceRecord],
  seedAttempts: ReadonlyArray<WebhookDeliveryAttempt> = []
): Layer.Layer<SeedWebhookStore> {
  return Layer.effect(SeedWebhookStore)(
    Effect.gen(function* () {
      const inventory = yield* SeedResourceInventory
      const endpoints: Array<SeedEndpointRow> = seedFixtures.map((fixture) => ({
        id: fixture.id,
        workspaceId: fixture.workspaceId ?? seedWorkspaceRecord.id,
        url: fixture.url,
        enabled: fixture.enabled,
        events: [...fixture.events],
        signingSecret:
          fixture.signingSecret ?? 'whsec_c2VlZF9maXh0dXJlX3NlY3JldF8zMl9ieXRlc19sbmc=',
        previousSigningSecret: null,
        previousSecretExpiresAt: null,
        consecutiveFailures: 0
      }))
      inventory.registerWebhooks((workspaceId, includeUnavailable) => {
        const ids: Array<WebhookEndpointId> = []
        for (const endpoint of endpoints) {
          if (
            endpoint.workspaceId === workspaceId &&
            (includeUnavailable || endpoint.enabled)
          ) {
            ids.push(endpoint.id)
          }
        }
        return ids
      })
      const deliveries: Array<SeedDeliveryRow> = seedDeliveries.map((fixture) =>
        toDeliveryRow(fixture, seedWorkspaceRecord.id)
      )

      function endpointFor(endpointId: WebhookEndpointId, workspaceId: WorkspaceId) {
        return (
          endpoints.find(
            (endpoint) =>
              endpoint.id === endpointId && endpoint.workspaceId === workspaceId
          ) ?? null
        )
      }

      return {
        endpoints,
        deliveries,
        attempts: [...seedAttempts],
        workspaces: seedWorkspaces,
        approvedDestinations: new Map<string, string>(),
        inventory,
        endpointFor,
        projection: (endpoint) => toProjection(endpoint, deliveries)
      }
    })
  ).pipe(Layer.provide(SeedResourceInventoryLayer))
}

function toDeliveryRow(
  fixture: SeedDeliveryFixture,
  fallbackWorkspaceId: WorkspaceId
): SeedDeliveryRow {
  return {
    id: fixture.id,
    endpointId: fixture.endpointId,
    workspaceId: fixture.workspaceId ?? fallbackWorkspaceId,
    eventType: fixture.eventType,
    status: fixture.status,
    attempts: fixture.attempts,
    lastAttemptAt: fixture.lastAttemptAt,
    nextAttemptAt: fixture.nextAttemptAt ?? null,
    responseStatus: fixture.responseStatus ?? null,
    payload: fixture.payload,
    requestHeaders: fixture.requestHeaders ?? null,
    responseBody: fixture.responseBody ?? null,
    replayedFrom: fixture.replayedFrom ?? null
  }
}

// Never expose the stored signing secret in endpoint reads.
function toProjection(
  endpoint: SeedEndpointRow,
  deliveries: ReadonlyArray<SeedDeliveryRow>
): WebhookEndpoint {
  const mine = deliveries.filter((row) => row.endpointId === endpoint.id)
  return {
    id: endpoint.id,
    url: endpoint.url,
    enabled: endpoint.enabled,
    events: [...endpoint.events],
    successRate: deliverySuccessRate(
      mine.length,
      mine.filter((row) => row.status === deliveredDeliveryStatus).length
    )
  }
}
