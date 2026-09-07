import { describe, expect, it } from 'vite-plus/test'

import { runOperator } from './billing-operator.ts'

const environment = {
  CLOUDFLARE_ACCOUNT_ID: 'account-1',
  CLOUDFLARE_API_TOKEN: 'token-1',
  CLOUDFLARE_DATABASE_ID: 'database-1',
  CLOUDFLARE_BILLING_QUEUE_ID: 'queue-1'
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) {
    return input.href
  }
  if (input instanceof Request) {
    return input.url
  }
  return input
}

describe('billing operator CLI', () => {
  it('decodes Cloudflare D1 query results wrapped in an array', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const output: Array<string> = []
    async function fetchImpl(input: RequestInfo | URL, init?: RequestInit) {
      requests.push({ url: requestUrl(input), init })
      return response({
        success: true,
        errors: [],
        result: [{ results: [{ workspace_id: 'wrk_starter', status: 'current' }] }]
      })
    }

    await runOperator(
      ['inspect', '--workspace', 'wrk_starter', '--limit', '2'],
      environment,
      fetchImpl,
      (text) => output.push(text)
    )

    const result = JSON.parse(output.join(''))
    expect(result).toMatchObject({
      workspaceId: 'wrk_starter',
      synchronization: [{ workspace_id: 'wrk_starter', status: 'current' }]
    })
    expect(result.checkoutClaims).toHaveLength(1)
    expect(requests).toHaveLength(4)
    expect(requests[0]?.url).toContain('/d1/database/database-1/query')
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: 'Bearer token-1'
    })
  })

  it('pushes an authenticated JSON operator retry only when executed', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const output: Array<string> = []
    async function fetchImpl(input: RequestInfo | URL, init?: RequestInit) {
      requests.push({ url: requestUrl(input), init })
      return response({ success: true, errors: [], result: null })
    }

    await runOperator(
      [
        'retry',
        '--workspace',
        'wrk_starter',
        '--operator',
        'operator@example.com',
        '--execute'
      ],
      environment,
      fetchImpl,
      (text) => output.push(text)
    )

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toContain('/queues/queue-1/messages')
    const body = requests[0]?.init?.body
    expect(body).toBe(
      JSON.stringify({
        body: {
          kind: 'billing.seat_sync',
          workspaceId: 'wrk_starter',
          reason: 'operator_retry',
          operatorId: 'operator@example.com'
        },
        content_type: 'json'
      })
    )
    expect(JSON.parse(output.join('')).dryRun).toBe(false)
  })

  it('lists supplied recovery evidence in a dry run', async () => {
    const output: Array<string> = []
    let requests = 0
    async function fetchImpl() {
      requests += 1
      return response({ success: true, errors: [], result: null })
    }

    await runOperator(
      [
        'retry',
        '--workspace',
        'wrk_starter',
        '--operator',
        'operator@example.com',
        '--customer',
        'cus_starter',
        '--checkout-session',
        'cs_starter'
      ],
      environment,
      fetchImpl,
      (text) => output.push(text)
    )

    expect(requests).toBe(0)
    expect(JSON.parse(output.join(''))).toMatchObject({
      dryRun: true,
      message: {
        recovery: {
          customerId: 'cus_starter',
          checkoutSessionId: 'cs_starter'
        }
      }
    })
  })
})
