// Node CLI protocol tests use the real HTTP decoder and a controlled fetch response.
// oxlint-disable vitest/no-import-node-test
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { inspectQueues, queueIsHealthy } from './queue-health.ts'

const now = 1_800_000
const account = 'a'.repeat(32)
const queueId = 'b'.repeat(32)
const environment = {
  CLOUDFLARE_ACCOUNT_ID: account,
  CLOUDFLARE_API_TOKEN: 'test-token',
  OPS_QUEUES: JSON.stringify([
    { id: queueId, name: 'isolated-queue', deadLetter: false }
  ])
}

await test('a stalled, nonempty queue trips the age policy and draining it recovers', () => {
  assert.equal(queueIsHealthy(1, now - 900_000, false, now), false)
  assert.equal(queueIsHealthy(1, now - 899_999, false, now), true)
  assert.equal(queueIsHealthy(0, 0, false, now), true)
  assert.equal(queueIsHealthy(1, 0, false, now), false)
  assert.equal(queueIsHealthy(1, now, true, now), false)
})
await test('reads provider metrics without consuming any messages', async () => {
  const observations = await inspectQueues(
    environment,
    (url, init) => {
      assert.equal(
        url,
        `https://api.cloudflare.com/client/v4/accounts/${account}/queues/${queueId}/metrics`
      )
      assert.equal(init?.method, undefined)
      return Promise.resolve(
        Response.json({
          success: true,
          result: { backlog_count: 0, oldest_message_timestamp_ms: 0 }
        })
      )
    },
    now
  )
  assert.equal(observations[0]?.healthy, true)
})
await test('provider failure and malformed success cannot produce healthy evidence', async () => {
  await assert.rejects(
    inspectQueues(
      environment,
      () => Promise.resolve(new Response(null, { status: 503 })),
      now
    )
  )
  await assert.rejects(
    inspectQueues(
      environment,
      () => Promise.resolve(Response.json({ success: true, result: {} })),
      now
    )
  )
})
