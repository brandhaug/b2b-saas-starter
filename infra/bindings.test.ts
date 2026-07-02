import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// Minimal JSONC → JSON: strips // and /* */ comments outside of strings.
// (No jsonc parser ships in the repo's dependency set.)
const stripJsonComments = (input: string): string => {
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

const readWranglerConfig = (app: string): Record<string, unknown> => {
  const raw = readFileSync(join(repoRoot, 'apps', app, 'wrangler.jsonc'), 'utf8')
  return JSON.parse(stripJsonComments(raw)) as Record<string, unknown>
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

const rateLimitBindings = (
  config: Record<string, unknown>
): WranglerRateLimitBinding[] => {
  const unsafe = config['unsafe'] as
    | { readonly bindings?: readonly WranglerRateLimitBinding[] }
    | undefined
  return [...(unsafe?.bindings ?? [])].filter((binding) => binding.type === 'ratelimit')
}

const expectRateLimitSync = (
  wrangler: readonly WranglerRateLimitBinding[],
  specs: readonly RateLimitBindingSpec[]
) => {
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

const expectConsumerSync = (
  consumer: WranglerQueueConsumer | undefined,
  queue: string,
  settings: QueueConsumerSettings,
  deadLetterQueue?: string
) => {
  expect(consumer, `no wrangler consumer declared for queue ${queue}`).toBeDefined()
  if (!consumer) return
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
    const queues = config['queues'] as
      | { readonly consumers?: readonly WranglerQueueConsumer[] }
      | undefined
    const consumers = queues?.consumers ?? []
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
    for (const app of ['api', 'background'] as const) {
      const config = readWranglerConfig(app)
      const queues = config['queues'] as
        | { readonly producers?: readonly { binding: string; queue: string }[] }
        | undefined
      const producer = queues?.producers?.find(
        (candidate) => candidate.binding === 'WEBHOOK_QUEUE'
      )
      expect(producer?.queue, `apps/${app} WEBHOOK_QUEUE producer`).toBe(
        webhookQueueName
      )
    }
  })
})
