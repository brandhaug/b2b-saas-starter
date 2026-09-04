import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { describe, expect, test } from 'vite-plus/test'
import { Schema } from 'effect'

import { createStarterClient, type StarterClient } from './index.ts'

/* oxlint-disable effect/noAsyncFunction -- the plain client's whole surface is promise-shaped; these tests exercise it as a caller would, on the promise seam the SDK exists to offer */

/**
 * The plain SDK client driven against the API worker's web handler with the
 * Seed layer (no D1) — the same fixture the local dev worker serves with no
 * provider configuration. The injected `fetch` is the promise seam the docs
 * describe: the client never knows it is not on a network.
 */

async function loadWorkerHandler() {
  const http = await import('api/src/http.ts')
  return http.buildWebHandler({}).handler
}

async function fetchThroughHandler(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const handle = await loadWorkerHandler()
  return handle(new Request(input, init))
}

const client: StarterClient = createStarterClient({
  baseUrl: 'https://api.test',
  apiToken: SEED_API_TOKEN,
  fetch: fetchThroughHandler
})

describe('plain SDK client against the API worker (seed)', () => {
  test('health check decodes the contract success shape', async () => {
    expect(await client.health.check()).toEqual({ status: 'ok' })
  })

  test('a paged list returns one Page and the iterator walks it all', async () => {
    const first = await client.workspace.notifications('starter-lab', { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.items[0]?.id).toBe('not_email')
    expect(first.nextCursor).not.toBe(null)

    const walked: Array<string> = []
    for await (const notification of client.workspace.notifications.iterate(
      'starter-lab',
      { limit: 2 }
    )) {
      walked.push(notification.id)
    }
    // Newest-first across page boundaries, every seed notification exactly
    // once, no duplicates — the keyset walk the REST surface serves.
    expect(walked).toEqual([
      'not_email',
      'not_export',
      'not_webhook',
      'not_token',
      'not_token_call',
      'not_billing',
      'not_rotation',
      'not_invite'
    ])
  })

  test('members page forward on id', async () => {
    const walked: Array<string> = []
    for await (const member of client.workspace.members.iterate('starter-lab')) {
      walked.push(member.id)
    }
    expect(walked).toEqual(walked.toSorted())
    expect(walked).toEqual(['usr_demo', 'usr_dev', 'usr_martin', 'usr_ops'])
  })

  test('every paged list endpoint answers the Page shape', async () => {
    const tokens = await client.workspace.apiTokens('starter-lab')
    expect(tokens.items.map((token) => token.id).toSorted()).toEqual([
      'tok_docs',
      'tok_mcp'
    ])
    expect(tokens.nextCursor).toBe(null)

    const webhooks = await client.workspace.webhooks('starter-lab')
    expect(webhooks.items.length).toBeGreaterThan(0)

    const audit = await client.workspace.auditEvents('starter-lab')
    expect(audit.items.length).toBeGreaterThan(0)
  })

  test('the overview endpoint keeps its non-paged shape', async () => {
    const overview = await client.workspace.overview('starter-lab')
    expect(overview.workspace.slug).toBe('starter-lab')
    expect(Array.isArray(overview.notifications)).toBe(true)
  })

  test('a bad token rejects with the contract error the worker serves', async () => {
    const bogus = createStarterClient({
      baseUrl: 'https://api.test',
      apiToken: 'bsk_live_bogus',
      fetch: fetchThroughHandler
    })
    const rejection = await bogus.workspace.notifications('starter-lab').then(
      () => null,
      (error: unknown) => error
    )
    // The rejection body is the contract's tagged error, decoded — not a
    // fetch failure or a plain string.
    const TaggedError = Schema.Struct({ _tag: Schema.String })
    const decodeTag = Schema.decodeUnknownSync(TaggedError)
    expect(decodeTag(rejection)._tag).toBe('Unauthorized')
  })
})
