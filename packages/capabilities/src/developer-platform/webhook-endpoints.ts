import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, webhookDeliveries, webhookEndpoints } from '@b2b-saas-starter/db'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { hashSha256, randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const WebhookEndpoint = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  enabled: Schema.Boolean,
  events: Schema.Array(Schema.String),
  successRate: Schema.Number
})
export type WebhookEndpoint = typeof WebhookEndpoint.Type

export type WebhookDeliveryAttemptInput = {
  readonly endpointId: string
  readonly eventType: string
  readonly status: 'delivered' | 'failed'
  readonly attempts: number
  readonly responseStatus?: number | null
  readonly nextAttemptAt?: string | null
}

export type CreateWebhookEndpointInput = {
  readonly url: string
  readonly events: readonly string[]
  readonly description?: string
  readonly actorUserId?: string
}

export type DisableWebhookEndpointInput = {
  readonly endpointId: string
  readonly actorUserId?: string
}

export type RotateWebhookSecretInput = {
  readonly endpointId: string
  readonly actorUserId?: string
}

export type WebhookEndpointsShape = {
  readonly list: Effect.Effect<readonly WebhookEndpoint[], never, WorkspaceContext>
  readonly create: (
    input: CreateWebhookEndpointInput
  ) => Effect.Effect<WebhookEndpoint, never, WorkspaceContext>
  readonly disable: (
    input: DisableWebhookEndpointInput
  ) => Effect.Effect<void, never, WorkspaceContext>
  readonly rotateSecret: (
    input: RotateWebhookSecretInput
  ) => Effect.Effect<{ readonly signingSecret: string }, never, WorkspaceContext>
  readonly getDispatchTarget: (endpointId: string) => Effect.Effect<{
    readonly id: string
    readonly url: string
    readonly signingSecret: string
  } | null>
  readonly recordDeliveryAttempt: (
    input: WebhookDeliveryAttemptInput
  ) => Effect.Effect<void>
}

export class WebhookEndpoints extends Context.Service<
  WebhookEndpoints,
  WebhookEndpointsShape
>()('@b2b-saas-starter/capabilities/WebhookEndpoints') {}

export const SeedWebhookEndpoints = (
  seed: readonly WebhookEndpoint[]
): Layer.Layer<WebhookEndpoints> =>
  Layer.succeed(WebhookEndpoints)({
    list: Effect.succeed(seed),
    create: (input) =>
      Effect.succeed({
        id: `wh_${Date.now()}`,
        url: input.url,
        enabled: true,
        events: [...input.events],
        successRate: 100
      }),
    disable: () => Effect.void,
    rotateSecret: () => Effect.succeed({ signingSecret: 'whsec_seed_rotated' }),
    getDispatchTarget: () => Effect.succeed(null),
    recordDeliveryAttempt: () => Effect.void
  })

const randomSecret = (): string => `whsec_${randomHex(24)}`

const hashSecret = hashSha256

export const LiveWebhookEndpoints: Layer.Layer<
  WebhookEndpoints,
  never,
  Database | AuditEventLog
> = Layer.effect(WebhookEndpoints)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog

    return {
      list: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const endpoints = yield* Effect.promise(() =>
          db
            .select()
            .from(webhookEndpoints)
            .where(eq(webhookEndpoints.workspaceId, ctx.workspace.id))
        )
        const results: WebhookEndpoint[] = []
        for (const endpoint of endpoints) {
          const deliveries = yield* Effect.promise(() =>
            db
              .select()
              .from(webhookDeliveries)
              .where(eq(webhookDeliveries.endpointId, endpoint.id))
          )
          const successful = deliveries.filter(
            (delivery) => delivery.status === 'delivered'
          ).length
          const successRate =
            deliveries.length === 0
              ? 100
              : Math.round((successful / deliveries.length) * 100)
          results.push({
            id: endpoint.id,
            url: endpoint.url,
            enabled: endpoint.enabled,
            events: endpoint.events,
            successRate
          })
        }
        return results
      }),
      create: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const signingSecret = randomSecret()
          const endpoint = {
            id: newCapabilityId('wh'),
            workspaceId: ctx.workspace.id,
            url: input.url,
            description: input.description,
            signingSecret,
            signingSecretHash: yield* Effect.promise(() => hashSecret(signingSecret)),
            enabled: true,
            events: [...input.events],
            createdAt: new Date().toISOString()
          }
          yield* Effect.promise(() => db.insert(webhookEndpoints).values(endpoint))
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: input.actorUserId ?? null,
            eventType: 'webhook_endpoint.created',
            targetType: 'webhook_endpoint',
            targetId: endpoint.id,
            metadata: { url: input.url, events: input.events }
          })
          return {
            id: endpoint.id,
            url: endpoint.url,
            enabled: endpoint.enabled,
            events: endpoint.events,
            successRate: 100
          }
        }),
      disable: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          yield* Effect.promise(() =>
            db
              .update(webhookEndpoints)
              .set({ enabled: false })
              .where(eq(webhookEndpoints.id, input.endpointId))
          )
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: input.actorUserId ?? null,
            eventType: 'webhook_endpoint.disabled',
            targetType: 'webhook_endpoint',
            targetId: input.endpointId,
            metadata: {}
          })
        }),
      rotateSecret: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const signingSecret = randomSecret()
          const signingSecretHash = yield* Effect.promise(() =>
            hashSecret(signingSecret)
          )
          yield* Effect.promise(() =>
            db
              .update(webhookEndpoints)
              .set({
                signingSecret,
                signingSecretHash
              })
              .where(eq(webhookEndpoints.id, input.endpointId))
          )
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: input.actorUserId ?? null,
            eventType: 'webhook_endpoint.secret_rotated',
            targetType: 'webhook_endpoint',
            targetId: input.endpointId,
            metadata: {}
          })
          return { signingSecret }
        }),
      getDispatchTarget: (endpointId) =>
        Effect.promise(() =>
          db
            .select()
            .from(webhookEndpoints)
            .where(eq(webhookEndpoints.id, endpointId))
            .limit(1)
        ).pipe(
          Effect.map((rows) => {
            const endpoint = rows[0]
            if (!endpoint || !endpoint.enabled) return null
            return {
              id: endpoint.id,
              url: endpoint.url,
              signingSecret: endpoint.signingSecret
            }
          })
        ),
      recordDeliveryAttempt: (input) =>
        Effect.promise(async () => {
          await db.insert(webhookDeliveries).values({
            id: newCapabilityId('whd'),
            endpointId: input.endpointId,
            eventType: input.eventType,
            status: input.status,
            attempts: input.attempts,
            lastAttemptAt: new Date().toISOString(),
            nextAttemptAt: input.nextAttemptAt ?? null,
            responseStatus: input.responseStatus ?? null
          })
        })
    }
  })
)
