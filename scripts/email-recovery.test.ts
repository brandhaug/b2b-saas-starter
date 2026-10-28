// Failure modes recorded before implementing the recovery command:
// - Failed concurrent drift loses the native sender's replacement ID.
// - A second drift pass still tries to repair privacy using the deleted sender ID.
// - The no-drift force planner reuses stale outputs instead of replacing privacy.
// - Recovery enables previews, patches the old sender, or leaves delivery broken.
// - A subsequent normal drift/apply repeats writes instead of converging.
import { strict as assert } from 'node:assert'
import * as Apply from 'alchemy/Apply'
import { CloudflareEnvironment } from '@alchemy.run/cloudflare'
import { Credentials } from '@distilled.cloud/cloudflare/Credentials'
import { SendingSubdomainProvider } from '@alchemy.run/cloudflare/Email'
import * as Drift from 'alchemy/Drift'
import { PropExpr, ResourceExpr } from 'alchemy/Output'
import * as Plan from 'alchemy/Plan'
import { type ResourceLike } from 'alchemy/Resource'
import { Stack } from 'alchemy/Stack'
import { Stage } from 'alchemy/Stage'
import { isActionState, State } from 'alchemy/State'
import { inMemoryState } from 'alchemy/State/InMemoryState'
import { type CreatedResourceState } from 'alchemy/State/ResourceState'
import { Cause, Effect, Exit, Layer, Redacted } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { test } from 'vite-plus/test'
import {
  EmailSendingPrivacyProvider,
  EmailSendingSubscriptionProvider
} from '../infra/email-sending.ts'

const accountId = 'a'.repeat(32)
const zoneId = 'b'.repeat(32)
const queueId = 'c'.repeat(32)
const subscriptionId = 'd'.repeat(32)
const oldId = 'e'.repeat(32)
const newId = 'f'.repeat(32)
const domain = 'mail.example.com'
const senderProps = { zoneId, name: domain }
const privacyProps = { accountId, zoneId, subdomainId: oldId, domain }
const subscriptionProps = { accountId, zoneId, queueId, domain, name: 'email-events' }
const events = [
  'message.delivered',
  'message.deferred',
  'message.bounced',
  'message.failed',
  'message.rejected',
  'message.complained'
]
const subscription = {
  id: subscriptionId,
  name: subscriptionProps.name,
  enabled: true,
  events,
  source: { type: 'email.sending', zone_id: zoneId, domain },
  destination: { type: 'queues.queue', queue_id: queueId },
  created_at: '2026-10-14T00:00:00Z',
  modified_at: '2026-10-14T00:00:00Z'
}
const apiBaseUrl = 'https://api.cloudflare.com/client/v4'
const zonePath = `/zones/${zoneId}`
const sendersPath = `${zonePath}/email/sending/subdomains`
const subscriptionsPath = `/accounts/${accountId}/event_subscriptions/subscriptions`

type TestResource = ResourceLike<
  string,
  Record<string, unknown>,
  object,
  undefined,
  undefined
>

function resource(
  id: string,
  type: string,
  props: Record<string, unknown>
): TestResource {
  return {
    FQN: id,
    LogicalId: id,
    Type: type,
    Props: props,
    RemovalPolicy: 'destroy',
    Namespace: undefined,
    Adopt: undefined,
    Mode: undefined,
    RequiresImplementation: undefined,
    FormerFqns: undefined,
    Attributes: {},
    Binding: undefined,
    Providers: undefined
  }
}

function row(
  value: TestResource,
  props: Record<string, unknown>,
  attr: Record<string, unknown>,
  downstream: Array<string>
): CreatedResourceState {
  return {
    status: 'created',
    namespace: undefined,
    fqn: value.FQN,
    logicalId: value.LogicalId,
    instanceId: value.FQN,
    resourceType: value.Type,
    props,
    attr,
    providerVersion: 0,
    bindings: [],
    downstream,
    removalPolicy: 'destroy'
  }
}

function stackFixture() {
  const sender = resource('sender', 'Cloudflare.Email.SendingSubdomain', senderProps)
  const senderOutput = new ResourceExpr<typeof senderProps & { subdomainId: string }>(
    sender
  )
  const privacy = resource('privacy', 'Starter.EmailSendingPrivacy', {
    accountId,
    zoneId: new PropExpr(senderOutput, 'zoneId'),
    subdomainId: new PropExpr(senderOutput, 'subdomainId'),
    domain: new PropExpr(senderOutput, 'name')
  })
  const privacyOutput = new ResourceExpr<typeof privacyProps>(privacy)
  const delivery = resource('subscription', 'Starter.EmailSendingSubscription', {
    ...subscriptionProps,
    zoneId: new PropExpr(privacyOutput, 'zoneId'),
    domain: new PropExpr(privacyOutput, 'domain')
  })
  return {
    stack: {
      name: 'email-recovery',
      stage: 'prod',
      resources: { sender, privacy, subscription: delivery },
      bindings: {},
      actions: {},
      output: {}
    },
    state: inMemoryState({
      'email-recovery': {
        prod: {
          sender: row(
            sender,
            senderProps,
            {
              ...senderProps,
              subdomainId: oldId,
              enabled: true,
              dkimSelector: undefined,
              returnPathDomain: undefined,
              created: undefined,
              modified: undefined
            },
            ['privacy']
          ),
          privacy: row(
            privacy,
            privacyProps,
            { ...privacyProps, previewEnabled: false },
            ['subscription']
          ),
          subscription: row(
            delivery,
            subscriptionProps,
            {
              ...subscriptionProps,
              subscriptionId,
              enabled: true,
              events
            },
            []
          )
        }
      }
    })
  }
}

function cloudflareFixture() {
  let sender:
    | { tag: string; name: string; enabled: boolean; preview_enabled: boolean }
    | undefined
  let delivery: typeof subscription | undefined = structuredClone(subscription)
  const writes: Array<{ method: string; path: string; body: unknown }> = []
  const requests: Array<{ method: string; path: string }> = []
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      assert.equal(url.origin, 'https://api.cloudflare.com')
      assert.equal(request.headers.authorization, 'Bearer test-token')
      const path = url.pathname.replace('/client/v4', '')
      const method = request.method
      requests.push({ method, path })
      const body: unknown =
        request.body._tag === 'Uint8Array'
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : undefined
      if (method !== 'GET') {
        writes.push({ method, path, body })
      }
      function response(result: unknown, status = 200) {
        return HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify(
              status === 404
                ? {
                    success: false,
                    errors: [{ code: 2033, message: 'Sending subdomain not found' }]
                  }
                : {
                    success: true,
                    errors: [],
                    result,
                    result_info: { page: 1, total_pages: 1 }
                  }
            ),
            { status }
          )
        )
      }
      if (method === 'GET' && path === zonePath) {
        return response({ id: zoneId, name: 'example.com', account: { id: accountId } })
      }
      if (method === 'GET' && path === `/accounts/${accountId}/queues/${queueId}`) {
        return response({ queue_id: queueId })
      }
      if (path === sendersPath) {
        if (method === 'GET') {
          return response(sender ? [sender] : [])
        }
        if (method === 'POST') {
          assert.equal(sender, undefined, 'recovery must not create another sender')
          assert.deepEqual(body, { name: domain })
          sender = { tag: newId, name: domain, enabled: true, preview_enabled: true }
          return response(sender)
        }
      }
      if (path === `${sendersPath}/${oldId}` && method === 'GET') {
        return response(undefined, 404)
      }
      if (path === `${sendersPath}/${newId}`) {
        assert.ok(sender)
        if (method === 'GET') {
          return response(sender)
        }
        if (method === 'PATCH') {
          assert.deepEqual(body, { preview_enabled: false })
          sender.preview_enabled = false
          return response(sender)
        }
      }
      if (path === subscriptionsPath) {
        if (method === 'GET') {
          return response(delivery ? [delivery] : [])
        }
        if (method === 'POST') {
          assert.equal(
            sender?.preview_enabled,
            false,
            'privacy must be applied before delivery'
          )
          assert.equal(
            delivery,
            undefined,
            'replacement must delete the old subscription first'
          )
          assert.deepEqual(body, {
            name: subscription.name,
            enabled: true,
            events,
            source: subscription.source,
            destination: subscription.destination
          })
          delivery = structuredClone(subscription)
          return response(delivery)
        }
      }
      if (path === `${subscriptionsPath}/${subscriptionId}`) {
        if (method === 'GET') {
          return response(delivery, delivery ? 200 : 404)
        }
        if (method === 'DELETE') {
          delivery = undefined
          return response({})
        }
      }
      throw new Error(`Unexpected HTTP request: ${method} ${url}`)
    })
  )
  return {
    client,
    writes,
    requests,
    breakDelivery: () => {
      delivery = { ...subscription, enabled: false, events: [] }
    },
    snapshot: () => structuredClone({ sender, delivery })
  }
}

test('failed native sender drift recovers through a no-drift force plan and then converges', async () => {
  const { stack, state } = stackFixture()
  const cloud = cloudflareFixture()
  const dependencies = Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient, cloud.client),
    Layer.succeed(Stage, 'prod'),
    Layer.succeed(Stack, stack),
    Layer.succeed(
      Credentials,
      Effect.succeed({
        type: 'apiToken',
        apiToken: Redacted.make('test-token'),
        apiBaseUrl
      })
    ),
    Layer.succeed(
      CloudflareEnvironment,
      Effect.succeed({
        type: 'apiToken',
        apiToken: Redacted.make('test-token'),
        accountId,
        source: { type: 'env' }
      })
    )
  )
  const nativeSender = SendingSubdomainProvider()
  const providers = Layer.mergeAll(
    nativeSender,
    EmailSendingPrivacyProvider,
    EmailSendingSubscriptionProvider
  ).pipe(Layer.provideMerge(dependencies))

  // oxlint-disable-next-line starter/no-run-promise-in-tests -- Runs the actual Alchemy engine with in-memory state and a closed HTTP fixture; no live credentials, clocks, or network.
  await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* yield* State
      function saved(fqn: string) {
        return store.get({ stack: stack.name, stage: stack.stage, fqn }).pipe(
          Effect.map((value) => {
            assert.ok(value && !isActionState(value))
            return value
          })
        )
      }
      const failed = yield* Effect.exit(Drift.repair(stack))
      assert.ok(
        Exit.isFailure(failed),
        'ordinary drift must expose the stale privacy ID'
      )
      const failures = Cause.squash(failed.cause)
      assert.ok(failures instanceof Drift.DriftResourceError)
      assert.equal(failures.fqn, 'privacy')
      assert.equal(failures.operation, 'create')
      assert.match(String(failures.cause), /404/u)
      assert.equal((yield* saved('sender')).attr?.subdomainId, newId)
      assert.equal((yield* saved('privacy')).props?.subdomainId, oldId)
      assert.equal(cloud.snapshot().sender?.preview_enabled, true)

      const repeated = yield* Effect.exit(Drift.repair(stack))
      assert.ok(
        Exit.isFailure(repeated),
        'retrying drift alone cannot resolve dependency outputs'
      )
      assert.equal((yield* saved('sender')).attr?.subdomainId, newId)
      assert.equal(cloud.writes.length, 1, 'only the first drift creates the sender')

      cloud.breakDelivery()
      const requestCount = cloud.requests.length
      const recovery = yield* Plan.make(stack, { force: true })
      assert.equal(
        cloud.requests.length,
        requestCount,
        'recovery planning must be read-only'
      )
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(recovery.resources).map(([id, node]) => [id, node.action])
        ),
        { sender: 'update', privacy: 'replace', subscription: 'replace' }
      )
      assert.equal(recovery.resources.privacy?.action, 'replace')
      assert.equal(recovery.resources.subscription?.action, 'replace')
      assert.equal(recovery.resources.privacy.props.subdomainId, newId)
      assert.equal(recovery.resources.privacy.deleteFirst, true)
      assert.equal(recovery.resources.subscription.deleteFirst, true)
      const recoveryStart = cloud.requests.length
      yield* Apply.apply(recovery)
      assert.ok(
        cloud.requests
          .slice(recoveryStart)
          .every(({ path }) => path !== `${sendersPath}/${oldId}`)
      )
      assert.deepEqual(cloud.writes, [
        { method: 'POST', path: sendersPath, body: { name: domain } },
        {
          method: 'DELETE',
          path: `${subscriptionsPath}/${subscriptionId}`,
          body: undefined
        },
        {
          method: 'PATCH',
          path: `${sendersPath}/${newId}`,
          body: { preview_enabled: false }
        },
        {
          method: 'POST',
          path: subscriptionsPath,
          body: {
            name: subscription.name,
            enabled: true,
            events,
            source: subscription.source,
            destination: subscription.destination
          }
        }
      ])
      assert.equal((yield* saved('privacy')).props?.subdomainId, newId)
      assert.equal((yield* saved('privacy')).attr?.previewEnabled, false)
      assert.deepEqual(cloud.snapshot().delivery, subscription)

      const settledWrites = structuredClone(cloud.writes)
      const drift = yield* Drift.repair(stack)
      // The native provider now observes previewEnabled. Refresh its cached
      // attributes after the privacy resource disabled previews during recovery.
      assert.deepEqual(
        Object.values(drift.resources).map(({ action }) => action),
        ['repaired', 'unchanged', 'unchanged']
      )
      const repeatedDrift = yield* Drift.repair(stack)
      assert.deepEqual(
        Object.values(repeatedDrift.resources).map(({ action }) => action),
        ['unchanged', 'unchanged', 'unchanged']
      )
      yield* Apply.apply(yield* Plan.make(stack, { force: true }))
      assert.deepEqual(
        cloud.writes,
        settledWrites,
        'normal drift/force deploy must converge without writes'
      )
      const settled = yield* Plan.make(stack)
      assert.deepEqual(
        Object.values(settled.resources).map(({ action }) => action),
        ['noop', 'noop', 'noop']
      )
    }).pipe(Effect.provide(Layer.merge(providers, state)), Effect.scoped)
  )
})
