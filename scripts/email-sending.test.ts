import { CloudflareEnvironment } from '@alchemy.run/cloudflare'
import { Stage } from 'alchemy/Stage'
import { Effect, Redacted } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { describe, expect, it } from 'vite-plus/test'
import { validateEmailSender } from '../infra/email-sending/api.ts'
import {
  makeEmailSendingLifecycle,
  discoverEmailEventsQueue,
  ensureSenderPrivacy,
  readSenderPrivacy
} from '../infra/email-sending.ts'

// Failure modes, written before the provider:
// - Preview or cross-account operations reach Cloudflare.
// - A zone belongs to another account, a domain escapes its zone, or a queue is absent.
// - A cold read steals another subscription, or pagination hides a duplicate.
// - A successful but unpersisted create is repeated and duplicates delivery.
// - No-op updates write, or updates change an immutable source.
// - Malformed JSON/envelopes, permission failures, and foreign IDs become "missing".
// - Destroy deletes a different source/queue, or fails on an already-deleted resource.
// Operator-stack failure modes, before implementation:
// - Queue discovery accepts a partial name, misses later duplicates, owns a queue,
//   uses another account, or trusts a list result contradicted by an account-scoped GET.
// - Discovery loops on malformed pagination or swallows permissions/malformed data.
// - Privacy updates the wrong sender or accepts an absent preview flag as disabled.
// - Privacy PATCH broadens settings, fails silently, repeats after success, or runs in previews.

const accountId = 'a'.repeat(32)
const zoneId = 'b'.repeat(32)
const queueId = 'c'.repeat(32)
const subscriptionId = 'd'.repeat(32)
const props = {
  accountId,
  zoneId,
  queueId,
  domain: 'mail.example.com',
  name: 'starter-prod-email'
}
const events = [
  'message.delivered',
  'message.deferred',
  'message.bounced',
  'message.failed',
  'message.rejected',
  'message.complained'
]
const observed = {
  id: subscriptionId,
  name: props.name,
  enabled: true,
  events,
  source: { type: 'email.sending', zone_id: zoneId, domain: props.domain },
  destination: { type: 'queues.queue', queue_id: queueId },
  created_at: '2026-10-14T00:00:00Z',
  modified_at: '2026-10-14T00:00:00Z'
}
const output = { ...props, subscriptionId, enabled: true, events }
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`
const subscriptions = `${base}/event_subscriptions/subscriptions`
function ok(result: unknown) {
  return { success: true, errors: [], result }
}
function page(result: Array<unknown>, current = 1, total = 1) {
  return { ...ok(result), result_info: { page: current, total_pages: total } }
}
const zone = ok({ id: zoneId, name: 'example.com', account: { id: accountId } })
const queue = ok({ queue_id: queueId })

it('rejects a foreign sender zone in preflight before any provisioning request', async () => {
  const test = scenario([
    {
      method: 'GET',
      url: `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
      authenticated: true,
      response: ok({ id: zoneId, name: 'example.com', account: { id: 'e'.repeat(32) } })
    }
  ])
  await expect(test.runEffect(validateEmailSender(props))).rejects.toThrow(
    'configured account'
  )
  test.done()
})

type Exchange = {
  method: string
  url: string
  response: unknown
  status?: number
  body?: unknown
  authenticated?: boolean
}
function scenario(exchanges: Array<Exchange>, stage = 'prod') {
  let index = 0
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const exchange = exchanges[index++]
      expect(exchange, `unexpected ${request.method} ${url}`).toBeDefined()
      if (!exchange) {
        throw new Error('Unexpected HTTP request')
      }
      expect(request.method).toBe(exchange.method)
      expect(url.toString()).toBe(exchange.url)
      if (exchange.authenticated) {
        expect(request.headers.authorization).toBe('Bearer test-token')
      }
      if (exchange.body !== undefined) {
        expect(request.body._tag).toBe('Uint8Array')
        if (request.body._tag === 'Uint8Array') {
          expect(JSON.parse(new TextDecoder().decode(request.body.body))).toEqual(
            exchange.body
          )
        }
      }
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(exchange.response), {
          status: exchange.status ?? 200
        })
      )
    })
  )
  function runEffect<A, E>(
    effect: Effect.Effect<A, E, HttpClient.HttpClient | CloudflareEnvironment | Stage>
  ) {
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- Scoped HTTP driver bridges the provider to vite-plus Promise assertions, with a scripted transport and no live clocks.
    return Effect.runPromise(
      effect.pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(
          CloudflareEnvironment,
          Effect.succeed({
            type: 'apiToken',
            apiToken: Redacted.make('test-token'),
            accountId,
            source: { type: 'env' }
          })
        ),
        Effect.provideService(Stage, stage),
        Effect.scoped
      )
    )
  }
  return {
    runEffect,
    run: <A, E>(
      f: (
        lifecycle: Effect.Success<ReturnType<typeof makeEmailSendingLifecycle>>
      ) => Effect.Effect<A, E>
    ) =>
      // oxlint-disable-next-line starter/no-run-promise-in-tests -- Scoped HTTP contract driver bridges the provider to vite-plus Promise assertions; the scripted transport uses no live clock or background fibers.
      Effect.runPromise(
        makeEmailSendingLifecycle({ accountId, stage }).pipe(
          Effect.flatMap(f),
          Effect.provideService(HttpClient.HttpClient, client),
          Effect.scoped
        )
      ),
    done: () => expect(index).toBe(exchanges.length)
  }
}
function validate(): Array<Exchange> {
  return [
    {
      method: 'GET',
      url: `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
      response: zone
    },
    { method: 'GET', url: `${base}/queues/${queueId}`, response: queue }
  ]
}
function list(response: unknown = page([]), current = 1): Exchange {
  return {
    method: 'GET',
    url: `${subscriptions}?page=${current}&per_page=100`,
    response
  }
}
function get(response: unknown = ok(observed), status = 200): Exchange {
  return { method: 'GET', url: `${subscriptions}/${subscriptionId}`, response, status }
}

const queueName = 'b2b-saas-starter-email-events'
const queueRow = { queue_id: queueId, queue_name: queueName }
function queuePage(response: unknown, current = 1): Exchange {
  return {
    method: 'GET',
    url: `${base}/queues?page=${current}&name=${queueName}`,
    response,
    authenticated: true
  }
}
function queueDetail(response: unknown = ok(queueRow), status = 200): Exchange {
  return {
    method: 'GET',
    url: `${base}/queues/${queueId}`,
    response,
    status,
    authenticated: true
  }
}
const senderProps = {
  accountId,
  zoneId,
  domain: props.domain,
  subdomainId: 'f'.repeat(32)
}
const sender = {
  tag: senderProps.subdomainId,
  name: props.domain,
  enabled: true,
  preview_enabled: true
}
const senderUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/email/sending/subdomains/${senderProps.subdomainId}`
function senderZone(): Exchange {
  return {
    method: 'GET',
    url: `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
    response: zone,
    authenticated: true
  }
}
function senderGet(response: unknown = ok(sender), status = 200): Exchange {
  return { method: 'GET', url: senderUrl, response, status, authenticated: true }
}

describe('operator email discovery and sender privacy', () => {
  it('resolves only the exact queue name across pages and verifies its account-scoped ID', async () => {
    const test = scenario([
      queuePage(page([{ ...queueRow, queue_name: `${queueName}-dlq` }], 1, 2)),
      queuePage(page([queueRow], 2, 2), 2),
      queueDetail()
    ])
    expect(
      await test.runEffect(discoverEmailEventsQueue({ accountId, queueName }))
    ).toBe(queueId)
    test.done()
  })

  it('paginates until an empty page when queue metadata is omitted', async () => {
    const test = scenario([
      queuePage(ok([queueRow])),
      queuePage(ok([]), 2),
      queueDetail()
    ])
    expect(
      await test.runEffect(discoverEmailEventsQueue({ accountId, queueName }))
    ).toBe(queueId)
    test.done()
  })

  it('rejects absent and ambiguous queues without creating anything', async () => {
    const absent = scenario([queuePage(page([]))])
    await expect(
      absent.runEffect(discoverEmailEventsQueue({ accountId, queueName }))
    ).rejects.toThrow('not found')
    absent.done()
    const duplicate = scenario([
      queuePage(page([queueRow], 1, 2)),
      queuePage(page([{ ...queueRow, queue_id: 'e'.repeat(32) }], 2, 2), 2)
    ])
    await expect(
      duplicate.runEffect(discoverEmailEventsQueue({ accountId, queueName }))
    ).rejects.toThrow('multiple')
    duplicate.done()
  })

  it('rejects another account before discovery', async () => {
    const test = scenario([])
    await expect(
      test.runEffect(discoverEmailEventsQueue({ accountId: 'e'.repeat(32), queueName }))
    ).rejects.toThrow('account')
    test.done()
  })

  it.each([
    ok({ ...queueRow, queue_name: 'foreign' }),
    ok({ ...queueRow, queue_id: 'e'.repeat(32) })
  ])('rejects a queue detail contradicting the account listing', async (response) => {
    const test = scenario([queuePage(page([queueRow])), queueDetail(response)])
    await expect(
      test.runEffect(discoverEmailEventsQueue({ accountId, queueName }))
    ).rejects.toThrow('scope')
    test.done()
  })

  it.each([403, 404])('preserves queue lookup HTTP %s failures', async (status) => {
    const test = scenario([
      queuePage(page([queueRow])),
      queueDetail({ success: false }, status)
    ])
    await expect(
      test.runEffect(discoverEmailEventsQueue({ accountId, queueName }))
    ).rejects.toThrow(String(status))
    test.done()
  })

  it.each([page([], 2, 2), ok([{ queue_name: queueName }])])(
    'rejects malformed queue pages',
    async (response) => {
      const test = scenario([queuePage(response)])
      await expect(
        test.runEffect(discoverEmailEventsQueue({ accountId, queueName }))
      ).rejects.toThrow(/pagination|Malformed/u)
      test.done()
    }
  )

  it('reads preview drift and disables only preview_enabled, then makes no repeated PATCH', async () => {
    const disabled = { ...sender, preview_enabled: false }
    const test = scenario([
      senderZone(),
      senderGet(),
      senderZone(),
      senderGet(),
      {
        method: 'PATCH',
        url: senderUrl,
        body: { preview_enabled: false },
        response: ok(disabled),
        authenticated: true
      },
      senderZone(),
      senderGet(ok(disabled))
    ])
    expect(await test.runEffect(readSenderPrivacy(senderProps))).toEqual({
      ...senderProps,
      previewEnabled: true
    })
    expect(await test.runEffect(ensureSenderPrivacy(senderProps))).toEqual({
      ...senderProps,
      previewEnabled: false
    })
    expect(await test.runEffect(ensureSenderPrivacy(senderProps))).toEqual({
      ...senderProps,
      previewEnabled: false
    })
    test.done()
  })

  it.each([
    { ...sender, name: 'foreign.example.com' },
    { ...sender, tag: 'e'.repeat(32) },
    { tag: sender.tag, name: sender.name, enabled: true },
    { ...sender, enabled: false }
  ])(
    'refuses mismatched, malformed, or disabled senders before PATCH',
    async (response) => {
      const test = scenario([senderZone(), senderGet(ok(response))])
      await expect(test.runEffect(ensureSenderPrivacy(senderProps))).rejects.toThrow(
        /scope|Malformed|enabled/u
      )
      test.done()
    }
  )

  it('fails when Cloudflare does not disable previews', async () => {
    const test = scenario([
      senderZone(),
      senderGet(),
      { method: 'PATCH', url: senderUrl, response: ok(sender) }
    ])
    await expect(test.runEffect(ensureSenderPrivacy(senderProps))).rejects.toThrow(
      'disable'
    )
    test.done()
  })

  it('fails when preview permissions are denied', async () => {
    const test = scenario([
      senderZone(),
      senderGet(),
      { method: 'PATCH', url: senderUrl, status: 403, response: { success: false } }
    ])
    await expect(test.runEffect(ensureSenderPrivacy(senderProps))).rejects.toThrow(
      '403'
    )
    test.done()
  })

  it('returns missing on privacy read but refuses to manufacture a missing sender', async () => {
    const test = scenario([
      senderZone(),
      senderGet({ success: false }, 404),
      senderZone(),
      senderGet({ success: false }, 404)
    ])
    expect(await test.runEffect(readSenderPrivacy(senderProps))).toBeUndefined()
    await expect(test.runEffect(ensureSenderPrivacy(senderProps))).rejects.toThrow(
      '404'
    )
    test.done()
  })

  it('rejects preview stages before lookup or privacy HTTP', async () => {
    const test = scenario([], 'pr-42')
    await expect(
      test.runEffect(discoverEmailEventsQueue({ accountId, queueName }))
    ).rejects.toThrow('production')
    await expect(test.runEffect(ensureSenderPrivacy(senderProps))).rejects.toThrow(
      'production'
    )
    test.done()
  })
})

describe('Email Sending subscription HTTP contract', () => {
  it('creates the exact six-event source and recovers an unpersisted create without another POST', async () => {
    const test = scenario([
      ...validate(),
      list(),
      {
        method: 'POST',
        url: subscriptions,
        body: {
          name: props.name,
          enabled: true,
          events,
          source: observed.source,
          destination: observed.destination
        },
        response: ok(observed)
      },
      ...validate(),
      list(page([observed]))
    ])
    expect(await test.run((api) => api.reconcile(props))).toEqual(output)
    expect(await test.run((api) => api.reconcile(props))).toEqual(output)
    test.done()
  })

  it('refreshes owned state and performs a no-op update without a write', async () => {
    const test = scenario([get(), ...validate(), get()])
    expect(await test.run((api) => api.read(props, output))).toEqual(output)
    expect(await test.run((api) => api.reconcile(props, output))).toEqual(output)
    test.done()
  })

  it('repairs disabled delivery and missing events using PATCH without changing source', async () => {
    const test = scenario([
      ...validate(),
      get(ok({ ...observed, enabled: false, events: ['message.delivered'] })),
      {
        method: 'PATCH',
        url: `${subscriptions}/${subscriptionId}`,
        body: {
          name: props.name,
          enabled: true,
          events,
          destination: observed.destination
        },
        response: ok(observed)
      }
    ])
    expect(await test.run((api) => api.reconcile(props, output))).toEqual(output)
    test.done()
  })

  it('requires replacement when the destination queue changes', async () => {
    const test = scenario([])
    await expect(
      test.run((api) => api.reconcile({ ...props, queueId: 'e'.repeat(32) }, output))
    ).rejects.toThrow('replacement')
    test.done()
  })

  it('does not replay an uncertain POST and recovers on the next reconciliation', async () => {
    const test = scenario([
      ...validate(),
      list(),
      { method: 'POST', url: subscriptions, status: 500, response: { success: false } },
      ...validate(),
      list(page([observed]))
    ])
    await expect(test.run((api) => api.reconcile(props))).rejects.toThrow('500')
    expect(await test.run((api) => api.reconcile(props))).toEqual(output)
    test.done()
  })

  it('paginates cold reads and recovers the exact named source and destination', async () => {
    const test = scenario([
      list(page([{ ...observed, source: { type: 'r2' } }], 1, 2)),
      list(page([observed], 2, 2), 2)
    ])
    const result = await test.run((api) => api.read(props))
    expect(result).toMatchObject(output)
    // An interrupted create must be recoverable by Alchemy's read-before-create.
    expect(Object.getOwnPropertySymbols(result)).toHaveLength(0)
    test.done()
  })

  it('refuses a sender subscription with a different resource name', async () => {
    const test = scenario([list(page([{ ...observed, name: 'other-owner' }]))])
    await expect(test.run((api) => api.read(props))).rejects.toThrow(
      'another resource name'
    )
    test.done()
  })

  it.each(['pr-12', 'dev'])('rejects %s stages before HTTP', async (stage) => {
    const test = scenario([], stage)
    await expect(test.run((api) => api.reconcile(props))).rejects.toThrow('production')
    test.done()
  })

  it('rejects account mismatch before HTTP', async () => {
    const test = scenario([])
    await expect(
      test.run((api) => api.reconcile({ ...props, accountId: 'e'.repeat(32) }))
    ).rejects.toThrow('account')
    test.done()
  })

  it('rejects a zone owned by another account', async () => {
    const test = scenario([
      {
        ...validate()[0],
        method: 'GET',
        url: `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
        response: ok({
          id: zoneId,
          name: 'example.com',
          account: { id: 'e'.repeat(32) }
        })
      }
    ])
    await expect(test.run((api) => api.reconcile(props))).rejects.toThrow('zone')
    test.done()
  })

  it('rejects a sender outside the specified zone', async () => {
    const test = scenario([
      {
        method: 'GET',
        url: `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
        response: zone
      }
    ])
    await expect(
      test.run((api) => api.reconcile({ ...props, domain: 'notexample.com' }))
    ).rejects.toThrow('domain')
    test.done()
  })

  it('stops when the target queue does not exist in the account', async () => {
    const test = scenario([
      {
        method: 'GET',
        url: `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
        response: zone
      },
      {
        method: 'GET',
        url: `${base}/queues/${queueId}`,
        status: 404,
        response: { success: false }
      }
    ])
    await expect(test.run((api) => api.reconcile(props))).rejects.toThrow('404')
    test.done()
  })

  it('rejects malformed Email Sending sources in an account-wide list', async () => {
    const test = scenario([
      list(
        page([{ ...observed, source: { type: 'email.sending', domain: props.domain } }])
      )
    ])
    await expect(test.run((api) => api.read(props))).rejects.toThrow('Malformed')
    test.done()
  })

  it('rejects pagination that repeats the wrong page', async () => {
    const test = scenario([list(page([], 1, 2)), list(page([], 1, 2), 2)])
    await expect(test.run((api) => api.read(props))).rejects.toThrow('pagination')
    test.done()
  })

  it('rejects source changes before HTTP, even when reconcile is called directly', async () => {
    const test = scenario([])
    await expect(
      test.run((api) =>
        api.reconcile({ ...props, domain: 'other.example.com' }, output)
      )
    ).rejects.toThrow('replacement')
    test.done()
  })

  it('rejects duplicate matches found on later pages', async () => {
    const test = scenario([
      list(page([observed], 1, 2)),
      list(page([{ ...observed, id: 'e'.repeat(32) }], 2, 2), 2)
    ])
    await expect(test.run((api) => api.read(props))).rejects.toThrow('multiple')
    test.done()
  })

  it('refuses an existing domain subscription targeting a different queue', async () => {
    const test = scenario([
      ...validate(),
      list(
        page([
          {
            ...observed,
            destination: { ...observed.destination, queue_id: 'e'.repeat(32) }
          }
        ])
      )
    ])
    await expect(test.run((api) => api.reconcile(props))).rejects.toThrow('scope')
    test.done()
  })

  it.each([401, 403, 429, 500])(
    'preserves HTTP %s failures rather than treating them as missing',
    async (status) => {
      const test = scenario([
        get(
          { success: false, errors: [{ code: 1000, message: 'provider failure' }] },
          status
        )
      ])
      await expect(test.run((api) => api.read(props, output))).rejects.toThrow(
        String(status)
      )
      test.done()
    }
  )

  it.each([
    { success: false, result: observed },
    ok({ ...observed, source: { type: 'email.sending', domain: props.domain } }),
    ok({ ...observed, destination: { type: 'queues.queue' } })
  ])('rejects malformed success responses', async (response) => {
    const test = scenario([get(response)])
    await expect(test.run((api) => api.read(props, output))).rejects.toThrow(
      'Malformed'
    )
    test.done()
  })

  it('recreates a missing owned subscription after a complete scoped list', async () => {
    const test = scenario([
      ...validate(),
      get({ success: false }, 404),
      list(),
      {
        method: 'POST',
        url: subscriptions,
        response: ok(observed)
      }
    ])
    expect(await test.run((api) => api.reconcile(props, output))).toEqual(output)
    test.done()
  })

  it('deletes only the verified owned subscription and tolerates repeated deletion', async () => {
    const test = scenario([
      get(),
      {
        method: 'DELETE',
        url: `${subscriptions}/${subscriptionId}`,
        response: ok(observed)
      },
      get({ success: false }, 404)
    ])
    await expect(test.run((api) => api.delete(output))).resolves.toBeUndefined()
    await expect(test.run((api) => api.delete(output))).resolves.toBeUndefined()
    test.done()
  })

  it('refuses to delete a subscription whose source changed', async () => {
    const test = scenario([
      get(
        ok({ ...observed, source: { ...observed.source, domain: 'other.example.com' } })
      )
    ])
    await expect(test.run((api) => api.delete(output))).rejects.toThrow('scope')
    test.done()
  })

  it('tolerates deletion by another actor between GET and DELETE', async () => {
    const test = scenario([
      get(),
      {
        method: 'DELETE',
        url: `${subscriptions}/${subscriptionId}`,
        status: 404,
        response: { success: false }
      }
    ])
    await expect(test.run((api) => api.delete(output))).resolves.toBeUndefined()
    test.done()
  })

  it('refuses an owned GET returning the wrong subscription ID', async () => {
    const test = scenario([get(ok({ ...observed, id: 'e'.repeat(32) }))])
    await expect(test.run((api) => api.delete(output))).rejects.toThrow('scope')
    test.done()
  })
})
