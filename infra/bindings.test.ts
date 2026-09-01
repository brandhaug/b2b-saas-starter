// This suite reads repo files from disk in a plain Vitest process on Bun, not
// inside a Worker or an Effect runtime, so the node builtins below are the
// platform APIs available to it. Pulling in `@effect/platform` FileSystem/Path
// would mean an Effect runtime per test for three synchronous file reads.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  apiRateLimits,
  webhookConsumerSettings,
  webhookDeadLetterQueueName,
  webhookDlqConsumerSettings,
  webhookQueueName,
  webRateLimits,
  type QueueConsumerSettings,
  type RateLimitBindingSpec
} from './bindings.ts'

// `infra/bindings.ts` is the source of truth alchemy deploys from; the
// wrangler.jsonc files hand-mirror the same specs for `wrangler dev`. This
// suite parses each wrangler config and fails red on any drift — the same
// pattern as apps/api/src/contract-sync.test.ts for HTTP contracts.

const repoRoot = join(import.meta.dirname, '..')

// Minimal JSONC → JSON: strips // and /* */ comments outside of strings.
// (No jsonc parser ships in the repo's dependency set.)
function stripJsonComments(input: string): string {
  let out = ''
  let inString = false
  let inLineComment = false
  let inBlockComment = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    const next = input[i + 1]
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
        out += char
      }
      continue
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i++
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && next === '/') {
      inLineComment = true
      i++
      continue
    }
    if (char === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }
    out += char
  }
  return out
}

type WranglerRateLimitBinding = {
  readonly name: string
  readonly type: string
  readonly namespace_id: string
  readonly simple: { readonly limit: number; readonly period: number }
}

type WranglerQueueConsumer = {
  readonly queue: string
  readonly max_batch_size: number
  readonly max_batch_timeout: number
  readonly max_retries: number
  readonly max_concurrency: number
  readonly retry_delay?: number
  readonly dead_letter_queue?: string
}

type WranglerQueueProducer = {
  readonly binding: string
  readonly queue: string
}

// Only the slice of wrangler.jsonc this suite asserts on. Declaring it as the
// parse result keeps every reader below cast-free.
type WranglerConfig = {
  readonly unsafe?: { readonly bindings?: ReadonlyArray<WranglerRateLimitBinding> }
  readonly queues?: {
    readonly consumers?: ReadonlyArray<WranglerQueueConsumer>
    readonly producers?: ReadonlyArray<WranglerQueueProducer>
  }
}

function readWranglerConfig(app: string): WranglerConfig {
  const raw = readFileSync(join(repoRoot, 'apps', app, 'wrangler.jsonc'), 'utf8')
  return JSON.parse(stripJsonComments(raw))
}

function rateLimitBindings(config: WranglerConfig): Array<WranglerRateLimitBinding> {
  return [...(config.unsafe?.bindings ?? [])].filter(
    (binding) => binding.type === 'ratelimit'
  )
}

function expectRateLimitSync(
  wrangler: ReadonlyArray<WranglerRateLimitBinding>,
  specs: ReadonlyArray<RateLimitBindingSpec>
) {
  expect(wrangler.map((binding) => binding.name)).toEqual(
    specs.map((spec) => spec.name)
  )
  for (const spec of specs) {
    const binding = wrangler.find((candidate) => candidate.name === spec.name)
    expect(
      binding,
      `wrangler.jsonc is missing rate-limit binding ${spec.name}`
    ).toBeDefined()
    expect(binding).toEqual({
      name: spec.name,
      type: 'ratelimit',
      namespace_id: spec.namespaceId,
      simple: { limit: spec.limit, period: spec.period }
    })
  }
}

function expectConsumerSync(
  consumer: WranglerQueueConsumer | undefined,
  queue: string,
  settings: QueueConsumerSettings,
  deadLetterQueue?: string
) {
  expect(consumer, `no wrangler consumer declared for queue ${queue}`).toBeDefined()
  if (!consumer) {
    return
  }
  expect(consumer.max_batch_size).toBe(settings.batchSize)
  // wrangler declares the batch timeout in seconds; alchemy in milliseconds.
  expect(consumer.max_batch_timeout * 1000).toBe(settings.maxWaitTimeMs)
  expect(consumer.max_retries).toBe(settings.maxRetries)
  expect(consumer.max_concurrency).toBe(settings.maxConcurrency)
  expect(consumer.retry_delay).toBe(settings.retryDelay)
  expect(consumer.dead_letter_queue).toBe(deadLetterQueue)
}

describe('infra/bindings.ts ↔ wrangler.jsonc sync', () => {
  it('apps/api rate-limit bindings match apiRateLimits', () => {
    expectRateLimitSync(rateLimitBindings(readWranglerConfig('api')), apiRateLimits)
  })

  it('apps/web rate-limit bindings match webRateLimits', () => {
    expectRateLimitSync(rateLimitBindings(readWranglerConfig('web')), webRateLimits)
  })

  it('apps/background queue consumers match the webhook consumer settings', () => {
    const config = readWranglerConfig('background')
    const consumers = config.queues?.consumers ?? []
    expect(consumers).toHaveLength(2)
    expectConsumerSync(
      consumers.find((consumer) => consumer.queue === webhookQueueName),
      webhookQueueName,
      webhookConsumerSettings,
      webhookDeadLetterQueueName
    )
    expectConsumerSync(
      consumers.find((consumer) => consumer.queue === webhookDeadLetterQueueName),
      webhookDeadLetterQueueName,
      webhookDlqConsumerSettings
    )
  })

  it('webhook producers point at the same queue name', () => {
    for (const app of ['api', 'background']) {
      const config = readWranglerConfig(app)
      const producer = config.queues?.producers?.find(
        (candidate) => candidate.binding === 'WEBHOOK_QUEUE'
      )
      expect(producer?.queue, `apps/${app} WEBHOOK_QUEUE producer`).toBe(
        webhookQueueName
      )
    }
  })
})
