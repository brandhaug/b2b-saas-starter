// Regression: replacing an upstream sender must replace both dependent identities;
// unresolved outputs must never be mistaken for stable fields on an update.
import { strict as assert } from 'node:assert'
import { test } from 'vite-plus/test'
import { CloudflareEnvironment } from '@alchemy.run/cloudflare'
import { Credentials } from '@distilled.cloud/cloudflare/Credentials'
import { SendingSubdomainProvider } from '@alchemy.run/cloudflare/Email'
import * as Plan from 'alchemy/Plan'
import { ResourceExpr, PropExpr } from 'alchemy/Output'
import { type ResourceLike } from 'alchemy/Resource'
import { inMemoryState } from 'alchemy/State/InMemoryState'
import { type CreatedResourceState } from 'alchemy/State/ResourceState'
import { Stage } from 'alchemy/Stage'
import { Effect, Layer, Redacted } from 'effect'
import { HttpClient } from 'effect/http'
import {
  EmailSendingPrivacyProvider,
  EmailSendingSubscriptionProvider
} from '../infra/email-sending.ts'

const accountId = 'a'.repeat(32)
const zoneId = 'b'.repeat(32)
const queueId = 'c'.repeat(32)
const subdomainId = 'f'.repeat(32)
const oldSender = { zoneId, name: 'mail.example.com' }
const oldPrivacy = { accountId, zoneId, subdomainId, domain: oldSender.name }
const oldSubscription = {
  accountId,
  zoneId,
  queueId,
  domain: oldSender.name,
  name: 'email-events'
}

type PlannerResource = ResourceLike<
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
): PlannerResource {
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
  value: ResourceLike,
  props: Record<string, unknown>,
  attr: Record<string, unknown>
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
    downstream: [],
    removalPolicy: 'destroy'
  }
}

async function planFor(name: string) {
  const sender = resource('sender', 'Cloudflare.Email.SendingSubdomain', {
    zoneId,
    name
  })
  const senderOutput = new ResourceExpr<typeof oldSender & { subdomainId: string }>(
    sender
  )
  const privacy = resource('privacy', 'Starter.EmailSendingPrivacy', {
    accountId,
    zoneId: new PropExpr(senderOutput, 'zoneId'),
    subdomainId: new PropExpr(senderOutput, 'subdomainId'),
    domain: new PropExpr(senderOutput, 'name')
  })
  const privacyOutput = new ResourceExpr<typeof oldPrivacy>(privacy)
  const subscription = resource('subscription', 'Starter.EmailSendingSubscription', {
    ...oldSubscription,
    zoneId: new PropExpr(privacyOutput, 'zoneId'),
    domain: new PropExpr(privacyOutput, 'domain')
  })
  const state = inMemoryState({
    planner: {
      prod: {
        sender: row(sender, oldSender, { ...oldSender, subdomainId, enabled: true }),
        privacy: row(privacy, oldPrivacy, { ...oldPrivacy, previewEnabled: false }),
        subscription: row(subscription, oldSubscription, {
          ...oldSubscription,
          subscriptionId: 'd'.repeat(32),
          enabled: true,
          events: []
        })
      }
    }
  })
  const dependencies = Layer.mergeAll(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() =>
        Effect.sync(() => {
          throw new Error('Planner test must not make HTTP requests')
        })
      )
    ),
    Layer.succeed(Stage, 'prod'),
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
  const senderProvider = SendingSubdomainProvider().pipe(
    Layer.provide(
      Layer.succeed(
        Credentials,
        Effect.succeed({
          type: 'apiToken',
          apiBaseUrl: 'https://api.cloudflare.com/client/v4',
          apiToken: Redacted.make('test-token')
        })
      )
    )
  )
  const providers = Layer.mergeAll(
    senderProvider,
    EmailSendingPrivacyProvider,
    EmailSendingSubscriptionProvider
  ).pipe(Layer.provideMerge(dependencies))
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- Bridges the pinned planner's scoped, in-memory Effect to Node assertions; no external HTTP or time is used.
  return Effect.runPromise(
    Plan.make({
      name: 'planner',
      stage: 'prod',
      resources: { sender, privacy, subscription },
      bindings: {},
      actions: {},
      output: {}
    }).pipe(Effect.provide(providers), Effect.provide(state), Effect.scoped)
  )
}

test('sender replacement propagates through privacy into the event subscription', async () => {
  const plan = await planFor('new.example.com')
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(plan.resources).map(([id, node]) => [id, node.action])
    ),
    {
      sender: 'replace',
      privacy: 'replace',
      subscription: 'replace'
    }
  )
  for (const id of ['privacy', 'subscription']) {
    const node = plan.resources[id]
    assert.equal(node?.action, 'replace')
    assert.equal(node.deleteFirst, true)
  }
})

test('unchanged sender identity does not cause perpetual replacement', async () => {
  const plan = await planFor(oldSender.name)
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(plan.resources).map(([id, node]) => [id, node.action])
    ),
    {
      sender: 'noop',
      privacy: 'noop',
      subscription: 'noop'
    }
  )
})
