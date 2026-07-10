import { describe, expect, test, vi } from 'vitest'
import { SEED_PLATFORM_API_TOKEN } from '@b2b-saas-starter/capabilities'
import type { ApiEnv } from './env.ts'
import { buildWebHandler } from './http.ts'

const handlerFor = (env: ApiEnv = {}) => buildWebHandler(env).handler
const bearer = { authorization: `Bearer ${SEED_PLATFORM_API_TOKEN}` }
const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://api.test${path}`, { headers })

describe('Booking Product Platform API v1', () => {
  test('keeps only health and documentation public and unversioned', async () => {
    expect((await handlerFor()(get('/health'))).status).toBe(200)
    expect((await handlerFor()(get('/reference'))).status).toBe(200)
    const response = await handlerFor()(get('/openapi.json'))
    const document = (await response.json()) as {
      info: { title: string }
      paths: Record<string, unknown>
    }
    expect(document.info.title).toBe('Booking Product Platform API')
    expect(Object.keys(document.paths).sort()).toEqual([
      '/health',
      '/v1/api-tokens',
      '/v1/api-tokens/{tokenId}',
      '/v1/appointments',
      '/v1/appointments/{appointmentId}',
      '/v1/merchant',
      '/v1/providers',
      '/v1/providers/{providerId}',
      '/v1/services',
      '/v1/services/{serviceId}',
      '/v1/webhook-endpoints',
      '/v1/webhook-endpoints/{endpointId}',
      '/v1/webhook-endpoints/{endpointId}/deliveries',
      '/v1/webhook-endpoints/{endpointId}/rotate-secret'
    ])
    expect(document.paths['/workspaces/{slug}/overview']).toBeUndefined()
    expect(document.paths['/mcp']).toBeUndefined()
  })

  test('requires a Platform bearer token and returns private typed errors', async () => {
    const response = await handlerFor()(get('/v1/merchant'))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
    const body = (await response.json()) as {
      error: { code: string; traceId: string; details: unknown }
    }
    expect(body.error.code).toBe('unauthorized')
    expect(body.error.traceId).toBeTruthy()
    expect(body.error.details).toEqual({})
  })

  test('reads Merchant, Services, Providers, and Appointments with stable envelopes', async () => {
    const handler = handlerFor()
    const merchant = await handler(get('/v1/merchant', bearer))
    expect(merchant.status).toBe(200)
    expect(merchant.headers.get('cache-control')).toBe('private, no-store')
    expect(await merchant.json()).toMatchObject({
      data: { id: 'mer_seed_booking_studio', currency: 'RON' }
    })

    for (const resource of ['services', 'providers', 'appointments']) {
      const response = await handler(get(`/v1/${resource}`, bearer))
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        data: Array<Record<string, unknown>>
        page: { nextCursor: string | null }
        total?: number
      }
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.page).toEqual({ nextCursor: null })
      expect(body.total).toBeUndefined()
      const id = body.data[0]!.id as string
      const detail = await handler(get(`/v1/${resource}/${id}`, bearer))
      expect(detail.status).toBe(200)
      expect(await detail.json()).toMatchObject({ data: { id } })
    }
  })

  test('Appointment responses expose Customer Details without leaking them elsewhere', async () => {
    const handler = handlerFor()
    const response = await handler(get('/v1/appointments', bearer))
    const body = (await response.json()) as {
      data: Array<{ customer: { name: string; email: string } }>
    }
    expect(body.data[0]?.customer.name).toBeTruthy()
    expect(body.data[0]?.customer.email).toContain('@')
    const openapi = await (await handler(get('/openapi.json'))).text()
    expect(openapi).not.toContain(body.data[0]!.customer.email)
    const invalid = await handler(
      get('/v1/appointments?cursor=customer@example.com', bearer)
    )
    expect(invalid.status).toBe(400)
    expect(await invalid.text()).not.toContain('customer@example.com')
  })

  test('applies repeatable filters and inclusive/exclusive Appointment times', async () => {
    const handler = handlerFor()
    const all = (await (await handler(get('/v1/appointments', bearer))).json()) as {
      data: Array<{ startsAt: string; provider: { id: string }; status: string }>
    }
    const appointment = all.data[0]!
    const included = (await (
      await handler(
        get(
          `/v1/appointments?status=${appointment.status}&providerId=${appointment.provider.id}&startsAtFrom=${encodeURIComponent(appointment.startsAt)}`,
          bearer
        )
      )
    ).json()) as { data: unknown[] }
    expect(included.data).toHaveLength(1)
    const excluded = (await (
      await handler(
        get(
          `/v1/appointments?startsAtBefore=${encodeURIComponent(appointment.startsAt)}`,
          bearer
        )
      )
    ).json()) as { data: Array<{ startsAt: string }> }
    expect(excluded.data.every((item) => item.startsAt < appointment.startsAt)).toBe(
      true
    )
    expect(excluded.data.some((item) => item.startsAt === appointment.startsAt)).toBe(
      false
    )
  })

  test('rejects invalid limits and tampered cursors with stable codes', async () => {
    const handler = handlerFor()
    for (const path of [
      '/v1/services?limit=101',
      '/v1/providers?cursor=tampered',
      '/v1/appointments?cursor=tampered'
    ]) {
      const response = await handler(get(path, bearer))
      expect(response.status).toBe(400)
      const body = (await response.json()) as { error: { code: string } }
      expect(['invalid_request', 'invalid_cursor']).toContain(body.error.code)
    }
  })

  test('uses PII-free endpoint/filter-bound cursors that do not bind limit', async () => {
    const handler = handlerFor()
    const first = (await (
      await handler(get('/v1/appointments?limit=1', bearer))
    ).json()) as { data: unknown[]; page: { nextCursor: string } }
    expect(first.data).toHaveLength(1)
    const cursor = first.page.nextCursor
    expect(cursor).toBeTruthy()
    expect(cursor).not.toContain('example.com')
    const payload = JSON.parse(
      atob(cursor.split('.')[0]!.replaceAll('-', '+').replaceAll('_', '/'))
    ) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['e', 'f', 'p', 'v', 'x'])
    expect(JSON.stringify(payload)).not.toContain('customer')
    expect(
      (
        await handler(
          get(`/v1/appointments?limit=50&cursor=${encodeURIComponent(cursor)}`, bearer)
        )
      ).status
    ).toBe(200)
    expect(
      (
        await handler(
          get(
            `/v1/appointments?status=scheduled&cursor=${encodeURIComponent(cursor)}`,
            bearer
          )
        )
      ).status
    ).toBe(400)
    expect(
      (await handler(get(`/v1/providers?cursor=${encodeURIComponent(cursor)}`, bearer)))
        .status
    ).toBe(400)
  })

  test('expires cursors after twenty-four hours', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'))
      const handler = handlerFor()
      const first = (await (
        await handler(get('/v1/appointments?limit=1', bearer))
      ).json()) as { page: { nextCursor: string } }
      vi.setSystemTime(new Date('2026-07-12T00:00:00.001Z'))
      const expired = await handler(
        get(
          `/v1/appointments?cursor=${encodeURIComponent(first.page.nextCursor)}`,
          bearer
        )
      )
      expect(expired.status).toBe(400)
      expect((await expired.json()) as object).toMatchObject({
        error: { code: 'invalid_cursor' }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  test('uses the data_read rate-limit bucket', async () => {
    const response = await handlerFor({
      RATE_LIMITER_DATA_READ: { limit: async () => ({ success: false }) }
    })(get('/v1/services', bearer))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    const body = (await response.json()) as { error: { details: { bucket: string } } }
    expect(body.error.details.bucket).toBe('data_read')
  })

  test('configures terminal webhook endpoints with one-time secret disclosure', async () => {
    const handler = handlerFor()
    const create = await handler(
      new Request('https://api.test/v1/webhook-endpoints', {
        method: 'POST',
        headers: { ...bearer, 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://hooks.example.com/appointments',
          eventTypes: ['appointment.created']
        })
      })
    )
    expect(create.status).toBe(201)
    const created = (await create.json()) as {
      data: { id: string; status: string; signingSecret?: string }
      signingSecret: string
    }
    expect(created.signingSecret).toMatch(/^whsec_/)
    expect(created.data.signingSecret).toBeUndefined()
    const list = await handler(get('/v1/webhook-endpoints', bearer))
    expect(await list.text()).not.toContain(created.signingSecret)
    const empty = await handler(
      get(`/v1/webhook-endpoints/${created.data.id}/deliveries`, bearer)
    )
    expect(await empty.json()).toEqual({ data: [], page: { nextCursor: null } })
    expect(
      (
        await handler(
          new Request(`https://api.test/v1/webhook-endpoints/${created.data.id}`, {
            method: 'DELETE',
            headers: bearer
          })
        )
      ).status
    ).toBe(204)
    expect(
      (
        await handler(
          new Request(`https://api.test/v1/webhook-endpoints/${created.data.id}`, {
            method: 'DELETE',
            headers: bearer
          })
        )
      ).status
    ).toBe(204)
    const patch = await handler(
      new Request(`https://api.test/v1/webhook-endpoints/${created.data.id}`, {
        method: 'PATCH',
        headers: { ...bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://other.example.com/hook' })
      })
    )
    expect(patch.status).toBe(404)
  })

  test('rejects unsafe webhook configuration and closed event families', async () => {
    const handler = handlerFor()
    for (const payload of [
      {
        url: 'https://user@example.com/hook',
        eventTypes: ['appointment.created']
      },
      {
        url: 'https://example.com/hook#secret',
        eventTypes: ['appointment.created']
      },
      { url: 'https://example.com/hook', eventTypes: ['customer.created'] },
      { url: 'https://example.com/hook', eventTypes: [] }
    ]) {
      const response = await handler(
        new Request('https://api.test/v1/webhook-endpoints', {
          method: 'POST',
          headers: { ...bearer, 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        })
      )
      expect(response.status).toBe(400)
    }
  })

  test('does not expose retired or customer booking routes', async () => {
    const handler = handlerFor()
    for (const path of [
      '/workspaces/starter-lab/overview',
      '/mcp',
      '/v1/customers',
      '/v1/availability',
      '/v1/booking-sessions'
    ]) {
      expect((await handler(get(path, bearer))).status).toBe(404)
    }
  })
})
