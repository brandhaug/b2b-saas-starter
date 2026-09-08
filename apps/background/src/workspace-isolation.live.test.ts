import { gunzipSync } from 'node:zlib'
import { expect, layer } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer, Option, Result, Schema } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/unstable/http'
import { Database } from '@b2b-saas-starter/db/service'
import { workspaceMembers, workspaces } from '@b2b-saas-starter/db/schema'
import { eq } from 'drizzle-orm'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  WebhookPublisher,
  publishWebhookEventWith,
  type WebhookQueueBinding,
  type WebhookQueueMessage
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import {
  WorkspaceExports,
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding,
  type WorkspaceExportQueueMessage
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestD1,
  TestDatabase
} from '@b2b-saas-starter/capabilities/testing/live-harness'
import { buildWorkspaceExport } from './export-consumer.ts'
import { deliverWebhook, recordDeadLetter } from './webhook-consumer.ts'

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))
const suspensionActions: ReadonlyArray<'suspend' | 'unsuspend'> = [
  'suspend',
  'unsuspend'
]

function queuePorts(batch?: {
  readonly started: () => void
  readonly confirmation: Effect.Effect<void, Error>
}) {
  const webhooks: Array<WebhookQueueMessage> = []
  const exports: Array<WorkspaceExportQueueMessage> = []
  const objects = new Map<string, Uint8Array>()
  const failures = { put: false, batch: false }
  const webhookQueue: WebhookQueueBinding = {
    send: (message) => {
      webhooks.push(message)
      return Promise.resolve()
    },
    sendBatch: (messages) => {
      webhooks.push(...Array.from(messages, ({ body }) => body))
      if (batch) {
        batch.started()
        // oxlint-disable-next-line starter/no-run-promise-in-tests -- queue binding promise port awaits the test-controlled confirmation
        return Effect.runPromise(batch.confirmation)
      }
      if (failures.batch) {
        return Promise.reject(new Error('test queue confirmation outage'))
      }
      return Promise.resolve()
    }
  }
  const exportQueue: WorkspaceExportQueueBinding = {
    send: (message) => {
      exports.push(message)
      return Promise.resolve()
    }
  }
  const bucket: WorkspaceExportBucketBinding = {
    put: (key, value) => {
      if (failures.put) {
        return Promise.reject(new Error('test R2 outage'))
      }
      objects.set(key, new Uint8Array(value))
      return Promise.resolve()
    },
    get: (key) => {
      const bytes = objects.get(key)
      if (!bytes) {
        return Promise.resolve(null)
      }
      const copy = new ArrayBuffer(bytes.length)
      new Uint8Array(copy).set(bytes)
      return Promise.resolve({
        size: bytes.length,
        arrayBuffer: () => Promise.resolve(copy)
      })
    }
  }
  return {
    webhooks,
    exports,
    objects,
    failures,
    bindings: {
      webhookQueue,
      workspaceExports: { queue: exportQueue, bucket }
    },
    env: {
      WEBHOOK_QUEUE: webhookQueue,
      WORKSPACE_EXPORT_QUEUE: exportQueue,
      WORKSPACE_EXPORT_BUCKET: bucket
    }
  }
}

function receiver() {
  const requests: Array<{ url: string; body: typeof Schema.Json.Type }> = []
  const response = { status: 200 }
  const http = Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => {
      if (request.body._tag !== 'Uint8Array') {
        return Effect.die('expected a serialized webhook request')
      }
      requests.push({
        url: request.url,
        body: decodeJson(new TextDecoder().decode(request.body.body))
      })
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response('', { status: response.status })
        )
      )
    })
  )
  return { requests, response, http }
}

function twoWorkspaces(name: string) {
  return Effect.gen(function* () {
    const db = yield* Database
    const a = { id: `wrk_${name}_a`, slug: `${name}-a`, userId: 'usr_owner' }
    const b = { id: `wrk_${name}_b`, slug: `${name}-b`, userId: 'usr_outsider' }
    for (const workspace of [a, b]) {
      yield* db.insert(workspaces).values({
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.slug,
        planId: 'team'
      })
      yield* db.insert(workspaceMembers).values({
        id: `mem_${workspace.id}`,
        workspaceId: workspace.id,
        userId: workspace.userId,
        role: 'owner'
      })
    }
    return { a, b }
  })
}

function envelope(body: unknown, attempts = 1) {
  return { id: 'queue-isolation', body, attempts }
}

function queued<T>(messages: ReadonlyArray<T>, index = 0): T {
  const message = messages[index]
  if (message === undefined) {
    throw new Error('expected a producer to enqueue work')
  }
  return message
}

function publishWebhook(
  workspace: { readonly slug: string; readonly userId: string },
  ports: ReturnType<typeof queuePorts>
) {
  return inWorkspace(
    workspace.slug,
    Effect.gen(function* () {
      const endpoints = yield* WebhookEndpoints
      yield* endpoints.create({
        url: `https://example.com/${workspace.slug}`,
        events: ['api_token.created']
      })
      const publisher = yield* WebhookPublisher
      yield* publisher.publish({
        eventType: 'api_token.created',
        payload: { marker: workspace.slug }
      })
      return queued(ports.webhooks, ports.webhooks.length - 1)
    }),
    { userId: workspace.userId },
    ports.bindings
  )
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'queued Workspace isolation',
  (it) => {
    it.effect(
      'enqueue rejection leaves owned replayable evidence and suppresses delayed accepted messages',
      () =>
        Effect.gen(function* () {
          const { a, b } = yield* twoWorkspaces('enqueue-failed')
          const ports = queuePorts()
          const sink = receiver()
          const DB = yield* TestD1
          const env = { DB, ...ports.env }
          const messageB = yield* publishWebhook(b, ports)
          ports.failures.batch = true
          const endpoint = yield* inWorkspace(
            a.slug,
            Effect.gen(function* () {
              const endpoints = yield* WebhookEndpoints
              const created = yield* endpoints.create({
                url: 'https://example.com/enqueue-failed-a',
                events: ['api_token.created']
              })
              const publisher = yield* WebhookPublisher
              yield* publishWebhookEventWith(publisher, {
                eventType: 'api_token.created',
                payload: { marker: 'enqueue-failed-a' }
              })
              return created.endpoint
            }),
            { userId: a.userId },
            ports.bindings
          )
          const failed = queued(ports.webhooks, 1)
          const replayed = yield* inWorkspace(
            a.slug,
            Effect.gen(function* () {
              const endpoints = yield* WebhookEndpoints
              expect(
                yield* endpoints.listDeliveries({ endpointId: endpoint.id })
              ).toMatchObject([
                {
                  id: failed.deliveryId,
                  status: 'failed_permanent',
                  attempts: 0,
                  payload: { marker: 'enqueue-failed-a' }
                }
              ])
              expect(
                yield* endpoints.listDeliveryAttempts({ deliveryId: failed.deliveryId })
              ).toMatchObject([
                {
                  phase: 'terminal',
                  attempts: 0,
                  failureReason:
                    'Queue enqueue confirmation failed; acceptance is unknown'
                }
              ])
              const audit = yield* AuditEventLog
              const events = (yield* audit.list({
                eventType: 'webhook.delivery_failed'
              })).items
              expect(events).toHaveLength(1)
              expect(yield* audit.get(queued(events).id)).toMatchObject({
                targetId: endpoint.id,
                metadata: {}
              })
              return yield* endpoints.replayDelivery({ deliveryId: failed.deliveryId })
            }),
            { userId: a.userId },
            ports.bindings
          )
          yield* inWorkspace(
            b.slug,
            Effect.gen(function* () {
              const endpoints = yield* WebhookEndpoints
              const foreign = yield* Effect.result(
                endpoints.replayDelivery({ deliveryId: failed.deliveryId })
              )
              expect(Result.isFailure(foreign)).toBe(true)
              expect(
                yield* endpoints.listDeliveries({ endpointId: messageB.endpointId })
              ).toMatchObject([
                {
                  id: messageB.deliveryId,
                  status: 'pending',
                  payload: { marker: 'enqueue-failed-b' }
                }
              ])
            }),
            { userId: b.userId },
            ports.bindings
          )
          expect(
            yield* deliverWebhook(envelope(failed), env).pipe(Effect.provide(sink.http))
          ).toBe('ack')
          expect(sink.requests).toEqual([])
          const replay = queued(ports.webhooks, 2)
          expect(replay.deliveryId).toBe(replayed.deliveryId)
          expect(replay.deliveryId).not.toBe(failed.deliveryId)
          expect(
            yield* deliverWebhook(envelope(replay), env).pipe(Effect.provide(sink.http))
          ).toBe('ack')
          expect(sink.requests).toMatchObject([
            {
              url: endpoint.url,
              body: {
                deliveryId: replay.deliveryId,
                payload: { marker: 'enqueue-failed-a' }
              }
            }
          ])
        })
    )

    it.effect(
      'enqueue confirmation failure preserves deliveries already advanced by partial batch acceptance',
      () =>
        Effect.gen(function* () {
          const { a } = yield* twoWorkspaces('enqueue-partial')
          const started = yield* Deferred.make<undefined>()
          const confirmation = yield* Deferred.make<undefined, Error>()
          const ports = queuePorts({
            started: () => {
              Deferred.doneUnsafe(started, Effect.succeed(undefined))
            },
            confirmation: Deferred.await(confirmation)
          })
          const sink = receiver()
          const DB = yield* TestD1
          const env = { DB, ...ports.env }
          yield* inWorkspace(
            a.slug,
            Effect.gen(function* () {
              const endpoints = yield* WebhookEndpoints
              for (const suffix of ['retry', 'delivered', 'pending']) {
                yield* endpoints.create({
                  url: `https://example.com/partial-${suffix}`,
                  events: ['api_token.created']
                })
              }
            }),
            { userId: a.userId },
            ports.bindings
          )
          const publishing = yield* inWorkspace(
            a.slug,
            Effect.gen(function* () {
              const publisher = yield* WebhookPublisher
              yield* publishWebhookEventWith(publisher, {
                eventType: 'api_token.created',
                payload: { marker: 'enqueue-partial-a' }
              })
            }),
            { userId: a.userId },
            ports.bindings
          ).pipe(Effect.forkChild)
          yield* Deferred.await(started)
          const retried = queued(ports.webhooks, 0)
          const delivered = queued(ports.webhooks, 1)
          const pending = queued(ports.webhooks, 2)
          sink.response.status = 503
          expect(
            yield* deliverWebhook(envelope(retried), env).pipe(
              Effect.provide(sink.http)
            )
          ).toBe('retry')
          sink.response.status = 200
          expect(
            yield* deliverWebhook(envelope(delivered), env).pipe(
              Effect.provide(sink.http)
            )
          ).toBe('ack')
          yield* Deferred.fail(
            confirmation,
            new Error('batch acceptance could not be confirmed')
          )
          yield* Fiber.join(publishing)
          yield* inWorkspace(
            a.slug,
            Effect.gen(function* () {
              const endpoints = yield* WebhookEndpoints
              for (const { message, status, attempts } of [
                { message: retried, status: 'failed', attempts: 1 },
                { message: delivered, status: 'delivered', attempts: 1 },
                { message: pending, status: 'failed_permanent', attempts: 0 }
              ]) {
                expect(
                  yield* endpoints.listDeliveries({ endpointId: message.endpointId })
                ).toMatchObject([
                  {
                    id: message.deliveryId,
                    status,
                    attempts,
                    payload: { marker: 'enqueue-partial-a' }
                  }
                ])
                expect(
                  yield* endpoints.listDeliveryAttempts({
                    deliveryId: message.deliveryId
                  })
                ).toHaveLength(1)
              }
              const audit = yield* AuditEventLog
              const events = (yield* audit.list({
                eventType: 'webhook.delivery_failed'
              })).items
              expect(events).toHaveLength(1)
              expect(yield* audit.get(queued(events).id)).toMatchObject({
                targetId: pending.endpointId,
                metadata: {}
              })
            }),
            { userId: a.userId },
            ports.bindings
          )
          expect(
            yield* deliverWebhook(envelope(retried, 2), env).pipe(
              Effect.provide(sink.http)
            )
          ).toBe('ack')
          expect(
            yield* deliverWebhook(envelope(delivered), env).pipe(
              Effect.provide(sink.http)
            )
          ).toBe('ack')
          expect(
            yield* deliverWebhook(envelope(pending), env).pipe(
              Effect.provide(sink.http)
            )
          ).toBe('ack')
          expect(sink.requests).toHaveLength(3)
        })
    )

    it.effect('fan-out dispatches only the persisted Workspace payload', () =>
      Effect.gen(function* () {
        const { a, b } = yield* twoWorkspaces('fanout')
        const ports = queuePorts()
        const sink = receiver()
        const DB = yield* TestD1
        const env = { DB, ...ports.env }
        const messageA = yield* publishWebhook(a, ports)
        const messageB = yield* publishWebhook(b, ports)
        const forged = {
          ...messageA,
          endpointId: messageB.endpointId,
          workspaceId: b.id
        }
        expect(
          yield* deliverWebhook(envelope(forged), env).pipe(Effect.provide(sink.http))
        ).toBe('ack')
        expect(sink.requests).toEqual([])
        const tamperedPayload = {
          ...messageB,
          payload: messageA.payload,
          eventType: 'foreign.event'
        }
        expect(
          yield* deliverWebhook(envelope(tamperedPayload), env).pipe(
            Effect.provide(sink.http)
          )
        ).toBe('ack')
        expect(
          yield* deliverWebhook(envelope(messageA), env).pipe(Effect.provide(sink.http))
        ).toBe('ack')
        expect(sink.requests).toEqual([
          {
            url: 'https://example.com/fanout-b',
            body: {
              deliveryId: messageB.deliveryId,
              eventType: 'api_token.created',
              payload: { marker: 'fanout-b' }
            }
          },
          {
            url: 'https://example.com/fanout-a',
            body: {
              deliveryId: messageA.deliveryId,
              eventType: 'api_token.created',
              payload: { marker: 'fanout-a' }
            }
          }
        ])
        for (const { workspace, message } of [
          { workspace: a, message: messageA },
          { workspace: b, message: messageB }
        ]) {
          const deliveries = yield* inWorkspace(
            workspace.slug,
            Effect.flatMap(WebhookEndpoints, (endpoints) =>
              endpoints.listDeliveries({ endpointId: message.endpointId })
            ),
            { userId: workspace.userId },
            ports.bindings
          )
          expect(deliveries).toMatchObject([
            {
              id: message.deliveryId,
              status: 'delivered',
              payload: { marker: workspace.slug }
            }
          ])
        }
      })
    )

    it.effect('retries, dead letters and replay retain delivery ownership', () =>
      Effect.gen(function* () {
        const { a, b } = yield* twoWorkspaces('retry')
        const ports = queuePorts()
        const sink = receiver()
        const DB = yield* TestD1
        const env = { DB, ...ports.env }
        const messageA = yield* publishWebhook(a, ports)
        const messageB = yield* publishWebhook(b, ports)
        sink.response.status = 503
        expect(
          yield* deliverWebhook(envelope(messageA), env).pipe(Effect.provide(sink.http))
        ).toBe('retry')
        const foreign = {
          ...messageA,
          endpointId: messageB.endpointId,
          workspaceId: b.id
        }
        expect(
          yield* deliverWebhook(envelope(foreign, 2), env).pipe(
            Effect.provide(sink.http)
          )
        ).toBe('ack')
        expect(yield* recordDeadLetter(envelope(foreign, 6), env)).toBe('ack')
        expect(
          yield* recordDeadLetter(
            envelope(
              {
                ...messageB,
                deliveryId: 'unknown-delivery',
                payload: messageA.payload
              },
              6
            ),
            env
          )
        ).toBe('ack')
        const beforeB = yield* inWorkspace(
          b.slug,
          Effect.flatMap(WebhookEndpoints, (endpoints) =>
            endpoints.listDeliveries({ endpointId: messageB.endpointId })
          ),
          { userId: b.userId },
          ports.bindings
        )
        expect(beforeB).toMatchObject([
          {
            id: messageB.deliveryId,
            status: 'pending',
            attempts: 0,
            payload: { marker: 'retry-b' }
          }
        ])
        expect(beforeB).toHaveLength(1)
        expect(sink.requests).toHaveLength(1)

        expect(
          yield* recordDeadLetter(
            envelope(
              { ...messageA, payload: messageB.payload, eventType: 'foreign.event' },
              6
            ),
            env
          )
        ).toBe('ack')
        const replayed = yield* inWorkspace(
          a.slug,
          Effect.gen(function* () {
            const endpoints = yield* WebhookEndpoints
            const history = yield* endpoints.listDeliveries({
              endpointId: messageA.endpointId
            })
            expect(history).toMatchObject([
              {
                id: messageA.deliveryId,
                status: 'dead_lettered',
                eventType: 'api_token.created',
                payload: { marker: 'retry-a' }
              }
            ])
            return yield* endpoints.replayDelivery({
              deliveryId: messageA.deliveryId
            })
          }),
          { userId: a.userId },
          ports.bindings
        )
        const replay = queued(ports.webhooks, 2)
        expect(replayed.deliveryId).toBe(replay.deliveryId)
        expect(replay.deliveryId).not.toBe(messageA.deliveryId)
        sink.response.status = 200
        expect(
          yield* deliverWebhook(envelope(replay), env).pipe(Effect.provide(sink.http))
        ).toBe('ack')
        expect(
          yield* deliverWebhook(envelope(messageB), env).pipe(Effect.provide(sink.http))
        ).toBe('ack')
        expect(sink.requests.map((request) => request.body)).toEqual([
          {
            deliveryId: messageA.deliveryId,
            eventType: 'api_token.created',
            payload: { marker: 'retry-a' }
          },
          {
            deliveryId: replay.deliveryId,
            eventType: 'api_token.created',
            payload: { marker: 'retry-a' }
          },
          {
            deliveryId: messageB.deliveryId,
            eventType: 'api_token.created',
            payload: { marker: 'retry-b' }
          }
        ])
      })
    )

    it.effect(
      'suspension and endpoint disablement stop queued deliveries after recovery',
      () =>
        Effect.gen(function* () {
          const { a, b } = yield* twoWorkspaces('suppress')
          const ports = queuePorts()
          const sink = receiver()
          const DB = yield* TestD1
          const env = { DB, ...ports.env }
          const messageA = yield* publishWebhook(a, ports)
          const messageB = yield* publishWebhook(b, ports)
          for (const action of suspensionActions) {
            yield* inWorkspace(
              a.slug,
              Effect.flatMap(WorkspaceSuspensionService, (suspension) =>
                suspension.transition({
                  workspaceId: a.id,
                  action,
                  actor: { userId: 'usr_sysadmin' },
                  internalReason: 'Isolation test',
                  customerExplanation: 'Test workspace paused'
                })
              ),
              undefined,
              ports.bindings
            )
            expect(
              yield* deliverWebhook(envelope(messageA), env).pipe(
                Effect.provide(sink.http)
              )
            ).toBe('ack')
          }
          for (const enabled of [false, true]) {
            yield* inWorkspace(
              b.slug,
              Effect.flatMap(WebhookEndpoints, (endpoints) =>
                endpoints.update({ endpointId: messageB.endpointId, enabled })
              ),
              { userId: b.userId },
              ports.bindings
            )
            expect(
              yield* deliverWebhook(envelope(messageB), env).pipe(
                Effect.provide(sink.http)
              )
            ).toBe('ack')
          }
          expect(sink.requests).toEqual([])
          const testSend = yield* inWorkspace(
            b.slug,
            Effect.flatMap(WebhookEndpoints, (endpoints) =>
              endpoints.sendTestEvent({ endpointId: messageB.endpointId })
            ),
            { userId: b.userId },
            ports.bindings
          )
          expect(testSend.deliveryId).toBe(queued(ports.webhooks, 2).deliveryId)
          expect(
            yield* deliverWebhook(envelope(queued(ports.webhooks, 2)), env).pipe(
              Effect.provide(sink.http)
            )
          ).toBe('ack')
          expect(sink.requests).toHaveLength(1)
          expect(sink.requests[0]?.url).toBe('https://example.com/suppress-b')
        })
    )

    it.effect(
      'exports retain their Workspace through R2 retry and duplicate execution',
      () =>
        Effect.gen(function* () {
          const { a, b } = yield* twoWorkspaces('archive')
          const ports = queuePorts()
          const DB = yield* TestD1
          const env = { DB, ...ports.env }
          for (const workspace of [a, b]) {
            yield* inWorkspace(
              workspace.slug,
              Effect.flatMap(WorkspaceExports, (exports) => exports.request),
              { userId: workspace.userId },
              ports.bindings
            )
          }
          const messageA = queued(ports.exports, 0)
          const messageB = queued(ports.exports, 1)
          expect(
            yield* buildWorkspaceExport(
              envelope({ ...messageA, workspaceId: b.id, workspaceSlug: b.slug }),
              env
            )
          ).toBe('ack')
          expect(ports.objects.size).toBe(0)
          ports.failures.put = true
          expect(yield* buildWorkspaceExport(envelope(messageA), env)).toBe('retry')
          ports.failures.put = false
          expect(yield* buildWorkspaceExport(envelope(messageA, 2), env)).toBe('ack')
          expect(yield* buildWorkspaceExport(envelope(messageB), env)).toBe('ack')
          const archiveA = queued([...ports.objects.values()], 0)
          const archiveB = queued([...ports.objects.values()], 1)
          const textA = new TextDecoder().decode(gunzipSync(archiveA))
          const textB = new TextDecoder().decode(gunzipSync(archiveB))
          expect(decodeJson(textA)).toMatchObject({
            workspace: { id: a.id },
            members: [{ email: 'owner@live.test' }]
          })
          expect(decodeJson(textB)).toMatchObject({
            workspace: { id: b.id },
            members: [{ email: 'outsider@live.test' }]
          })
          expect(textA).not.toContain('outsider@live.test')
          expect(textA).not.toContain(b.id)
          expect(textB).not.toContain('owner@live.test')
          expect(textB).not.toContain(a.id)
          const db = yield* Database
          yield* db
            .update(workspaces)
            .set({ name: 'Changed after export' })
            .where(eq(workspaces.id, a.id))
          expect(yield* buildWorkspaceExport(envelope(messageA, 3), env)).toBe('ack')
          expect([...ports.objects.values()]).toEqual([archiveA, archiveB])
        })
    )

    it.effect(
      'requester removal preserves scheduled export authority but prevents new member access',
      () =>
        Effect.gen(function* () {
          const { a, b } = yield* twoWorkspaces('requester-removed')
          const ports = queuePorts()
          const DB = yield* TestD1
          const env = { DB, ...ports.env }
          const job = yield* inWorkspace(
            a.slug,
            Effect.flatMap(WorkspaceExports, (exports) => exports.request),
            { userId: a.userId },
            ports.bindings
          )
          const db = yield* Database
          yield* db
            .delete(workspaceMembers)
            .where(eq(workspaceMembers.id, `mem_${a.id}`))
          expect(
            yield* buildWorkspaceExport(envelope(queued(ports.exports)), env)
          ).toBe('ack')
          const archive = queued([...ports.objects.values()])
          const text = new TextDecoder().decode(gunzipSync(archive))
          expect(decodeJson(text)).toMatchObject({
            exportId: job.id,
            workspace: { id: a.id },
            members: []
          })
          expect(text).not.toContain('outsider@live.test')
          const denied = yield* inWorkspace(
            a.slug,
            Effect.flatMap(WorkspaceExports, (exports) =>
              exports.issueDownloadLink({ exportId: job.id })
            ),
            { userId: a.userId },
            ports.bindings
          ).pipe(Effect.flip)
          expect(denied._tag).toBe('WorkspaceNotFound')
          const other = yield* inWorkspace(
            b.slug,
            Effect.flatMap(WorkspaceExports, (exports) => exports.list),
            { userId: b.userId },
            ports.bindings
          )
          expect(other).toEqual([])
        })
    )

    it.effect(
      'suspended and reassigned-slug exports never become downloadable after recovery',
      () =>
        Effect.gen(function* () {
          const { a, b } = yield* twoWorkspaces('export-suppression')
          const ports = queuePorts()
          const DB = yield* TestD1
          const env = { DB, ...ports.env }
          for (const workspace of [a, b]) {
            yield* inWorkspace(
              workspace.slug,
              Effect.flatMap(WorkspaceExports, (exports) => exports.request),
              { userId: workspace.userId },
              ports.bindings
            )
          }
          const messageA = queued(ports.exports, 0)
          const messageB = queued(ports.exports, 1)
          for (const action of suspensionActions) {
            yield* inWorkspace(
              a.slug,
              Effect.flatMap(WorkspaceSuspensionService, (suspension) =>
                suspension.transition({
                  workspaceId: a.id,
                  action,
                  actor: { userId: 'usr_sysadmin' },
                  internalReason: 'Isolation test',
                  customerExplanation: 'Test workspace paused'
                })
              ),
              undefined,
              ports.bindings
            )
            expect(yield* buildWorkspaceExport(envelope(messageA), env)).toBe('ack')
          }
          const db = yield* Database
          yield* db
            .update(workspaces)
            .set({ slug: `${b.slug}-renamed` })
            .where(eq(workspaces.id, b.id))
          yield* db
            .update(workspaces)
            .set({ slug: b.slug })
            .where(eq(workspaces.id, a.id))
          expect(yield* buildWorkspaceExport(envelope(messageB), env)).toBe('ack')
          expect(ports.objects.size).toBe(0)
          for (const { slug, message } of [
            { slug: b.slug, message: messageA },
            { slug: `${b.slug}-renamed`, message: messageB }
          ]) {
            const status = yield* inWorkspace(
              slug,
              Effect.flatMap(WorkspaceExports, (exports) => exports.list),
              undefined,
              ports.bindings
            )
            expect(status).toMatchObject([{ id: message.exportId, status: 'failed' }])
            const link = yield* inWorkspace(
              slug,
              Effect.flatMap(WorkspaceExports, (exports) =>
                exports.issueDownloadLink({ exportId: message.exportId })
              ),
              undefined,
              ports.bindings
            )
            expect(Option.isNone(link)).toBe(true)
          }
        })
    )
  }
)
