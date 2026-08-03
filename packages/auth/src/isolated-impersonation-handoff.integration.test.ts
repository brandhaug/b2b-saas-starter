import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { chromium } from '@playwright/test'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  merchantMemberships,
  merchants,
  session,
  user
} from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { eq } from 'drizzle-orm'
import { createMerchantAuth } from './index.ts'
import {
  createIsolatedImpersonationHandoff,
  createOperationsHandoffAuth
} from './isolated-impersonation-handoff.ts'

const operationsOrigin = 'https://operations.example.test'
const merchantOrigin = 'https://merchant.example.test'
const password = 'correct-horse-battery-staple'

const cookiePair = (response: Response): string =>
  (response.headers.get('set-cookie') ?? '').split(';')[0]!

const toWebRequest = async (request: IncomingMessage): Promise<Request> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
    else if (value !== undefined) headers.set(name, value)
  }
  const method = request.method ?? 'GET'
  return new Request(`http://${request.headers.host}${request.url}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : { body: Buffer.concat(chunks).toString('utf8') })
  })
}

const writeWebResponse = async (
  target: ServerResponse,
  response: Response
): Promise<void> => {
  target.statusCode = response.status
  response.headers.forEach((value, name) => target.setHeader(name, value))
  target.end(Buffer.from(await response.arrayBuffer()))
}

describe('isolated Better Auth impersonation handoff', () => {
  let testD1: TestD1

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    await testD1.d1
      .prepare(
        `CREATE TABLE impersonation_handoff_spike (
          id TEXT PRIMARY KEY NOT NULL,
          ticket_hash TEXT UNIQUE NOT NULL,
          operator_user_id TEXT NOT NULL,
          operator_session_id TEXT NOT NULL,
          target_user_id TEXT NOT NULL,
          merchant_id TEXT NOT NULL,
          merchant_origin TEXT NOT NULL,
          operations_return_url TEXT NOT NULL,
          status TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          merchant_session_id TEXT,
          consumed_at INTEGER,
          stopped_at INTEGER,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        )`
      )
      .run()
  }, 30_000)

  afterAll(async () => {
    await testD1?.dispose()
  })

  const setup = async (
    options: {
      now?: () => Date
      sessionId?: () => string
      operationsOrigin?: string
      merchantOrigin?: string
      production?: boolean
    } = {}
  ) => {
    const fixtureOperationsOrigin = options.operationsOrigin ?? operationsOrigin
    const fixtureMerchantOrigin = options.merchantOrigin ?? merchantOrigin
    const production = options.production ?? true
    const db = createDb(testD1.d1)
    const operationVerificationLinks: string[] = []
    const merchantVerificationLinks: string[] = []
    const operationsAuth = createOperationsHandoffAuth({
      db,
      secret: 'operations-secret-that-is-deliberately-distinct-and-long',
      baseURL: fixtureOperationsOrigin,
      trustedOrigins: [fixtureOperationsOrigin],
      production,
      sendVerificationEmail: async ({ url }) => {
        operationVerificationLinks.push(url)
      }
    })
    const merchantAuth = createMerchantAuth({
      db,
      secret: 'merchant-secret-that-is-also-distinct-and-long-enough',
      baseURL: fixtureMerchantOrigin,
      trustedOrigins: [fixtureMerchantOrigin],
      production,
      sendVerificationEmail: async ({ url }) => {
        merchantVerificationLinks.push(url)
      },
      sendResetPassword: async () => undefined
    })
    const callAuth = (
      auth: { readonly handler: (request: Request) => Promise<Response> },
      origin: string,
      path: string,
      body: object,
      cookie?: string
    ) =>
      auth.handler(
        new Request(`${origin}/api/auth${path}`, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {})
          },
          body: JSON.stringify(body)
        })
      )

    const operatorEmail = `operator-${crypto.randomUUID()}@example.test`
    await callAuth(operationsAuth, fixtureOperationsOrigin, '/sign-up/email', {
      name: 'System Operator',
      email: operatorEmail,
      password,
      callbackURL: `${fixtureOperationsOrigin}/verified`
    })
    await operationsAuth.handler(new Request(operationVerificationLinks[0]!))
    const operatorSignIn = await callAuth(
      operationsAuth,
      fixtureOperationsOrigin,
      '/sign-in/email',
      { email: operatorEmail, password }
    )
    const operationsCookie = cookiePair(operatorSignIn)
    const operator = await operationsAuth.api.getSession({
      headers: new Headers({ cookie: operationsCookie })
    })

    const targetEmail = `merchant-${crypto.randomUUID()}@example.test`
    await callAuth(merchantAuth, fixtureMerchantOrigin, '/sign-up/email', {
      name: 'Merchant Member',
      email: targetEmail,
      password,
      callbackURL: `${fixtureMerchantOrigin}/verified`
    })
    await merchantAuth.handler(new Request(merchantVerificationLinks[0]!))
    const [target] = await db
      .select()
      .from(user)
      .where(eq(user.email, targetEmail))
      .limit(1)
    const merchantId = `merchant-${crypto.randomUUID()}`
    const timestamp = new Date().toISOString()
    await db.insert(merchants).values({
      id: merchantId,
      publicName: 'Handoff Test Merchant',
      slug: `handoff-${crypto.randomUUID()}`,
      timezone: 'Europe/Bucharest',
      currency: 'EUR',
      createdAt: timestamp,
      updatedAt: timestamp
    })
    await db.insert(merchantMemberships).values({
      merchantId,
      userId: target!.id,
      role: 'owner',
      createdAt: timestamp
    })

    const handoff = createIsolatedImpersonationHandoff({
      d1: testD1.d1,
      operationsAuth,
      merchantAuth,
      operationsOrigin: fixtureOperationsOrigin,
      merchantOrigin: fixtureMerchantOrigin,
      ...(options.now ? { now: options.now } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {})
    })
    const issue = async (
      override: { targetUserId?: string; merchantId?: string } = {}
    ) => {
      const response = await handoff.operationsHandler(
        new Request(`${fixtureOperationsOrigin}/impersonation/handoffs`, {
          method: 'POST',
          headers: {
            origin: fixtureOperationsOrigin,
            cookie: operationsCookie,
            'content-type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            targetUserId: override.targetUserId ?? target!.id,
            merchantId: override.merchantId ?? merchantId,
            returnPath: `/merchants/${merchantId}/members/${target!.id}`
          })
        })
      )
      const html = await response.text()
      const ticket = html.match(/name="ticket" value="([^"]+)"/)?.[1]
      return { response, html, ticket: ticket! }
    }
    const exchange = (ticket: string, cookie?: string) =>
      handoff.merchantHandler(
        new Request(`${fixtureMerchantOrigin}/impersonation/handoffs/exchange`, {
          method: 'POST',
          headers: {
            origin: fixtureOperationsOrigin,
            'content-type': 'application/x-www-form-urlencoded',
            ...(cookie ? { cookie } : {})
          },
          body: new URLSearchParams({ ticket })
        })
      )

    return {
      db,
      operationsAuth,
      merchantAuth,
      operationsCookie,
      operator: operator!,
      target: target!,
      merchantId,
      targetEmail,
      callAuth,
      handoff,
      issue,
      exchange,
      operationsOrigin: fixtureOperationsOrigin,
      merchantOrigin: fixtureMerchantOrigin
    }
  }

  it('atomically exchanges a top-level POST into a distinct Better Auth Merchant session and stops back at Operations', async () => {
    const fixture = await setup()
    const begin = await fixture.issue()
    expect(begin.response.status).toBe(200)
    expect(begin.html).toContain(
      `action="${merchantOrigin}/impersonation/handoffs/exchange"`
    )
    expect(begin.html).toContain('method="post"')
    expect(begin.ticket).toHaveLength(43)
    expect(begin.response.url).not.toContain(begin.ticket)
    expect(fixture.operationsCookie).toMatch(/^__Secure-operations\.session_token=/)

    const persisted = await testD1.d1
      .prepare(
        'SELECT ticket_hash FROM impersonation_handoff_spike WHERE target_user_id = ?1'
      )
      .bind(fixture.target.id)
      .first<{ readonly ticket_hash: string }>()
    expect(persisted?.ticket_hash).not.toBe(begin.ticket)

    const activation = await fixture.exchange(begin.ticket)
    expect(activation.status).toBe(303)
    expect(activation.headers.get('location')).toBe(`${merchantOrigin}/`)
    const merchantCookie = cookiePair(activation)
    expect(merchantCookie).toMatch(/^__Secure-merchant\.session_token=/)
    expect(activation.headers.get('set-cookie')).not.toMatch(/Domain=/i)
    expect(merchantCookie).not.toContain(fixture.operationsCookie.split('=')[1]!)

    const impersonated = await fixture.merchantAuth.api.getSession({
      headers: new Headers({ cookie: merchantCookie })
    })
    expect(impersonated?.user.id).toBe(fixture.target.id)
    expect(impersonated?.session.impersonatedBy).toBe(fixture.operator.user.id)
    expect(
      await fixture.merchantAuth.api.getSession({
        headers: new Headers({ cookie: fixture.operationsCookie })
      })
    ).toBeNull()
    expect(
      await fixture.operationsAuth.api.getSession({
        headers: new Headers({ cookie: merchantCookie })
      })
    ).toBeNull()

    const replay = await fixture.exchange(begin.ticket)
    expect(replay.status).toBe(400)
    expect(replay.headers.has('set-cookie')).toBe(false)

    const stop = await fixture.handoff.merchantHandler(
      new Request(`${merchantOrigin}/impersonation/stop`, {
        method: 'POST',
        headers: { origin: merchantOrigin, cookie: merchantCookie }
      })
    )
    expect(stop.status).toBe(303)
    expect(stop.headers.get('location')).toBe(
      `${operationsOrigin}/merchants/${fixture.merchantId}/members/${fixture.target.id}?impersonation=stopped`
    )
    expect(stop.headers.get('set-cookie')).toMatch(
      /^__Secure-merchant\.session_token=; Max-Age=0/
    )
    expect(stop.headers.get('set-cookie')).not.toContain('operations')
    expect(
      await fixture.merchantAuth.api.getSession({
        headers: new Headers({ cookie: merchantCookie })
      })
    ).toBeNull()

    const stockAdmin = await fixture.merchantAuth.handler(
      new Request(`${merchantOrigin}/api/auth/admin/list-users`)
    )
    expect(stockAdmin.status).toBe(404)
    expect(
      (
        await fixture.operationsAuth.handler(
          new Request(`${operationsOrigin}/api/auth/admin/list-users`)
        )
      ).status
    ).toBe(404)
  })

  it('rejects malformed, expired, mismatched, and partially processed handoffs', async () => {
    let clock = new Date('2026-07-19T08:00:00.000Z')
    const fixture = await setup({ now: () => clock })

    expect((await fixture.exchange('not-a-ticket')).status).toBe(400)
    expect(
      (await fixture.issue({ targetUserId: fixture.operator.user.id })).response.status
    ).toBe(400)

    const expired = await fixture.issue()
    clock = new Date(clock.getTime() + 61_000)
    expect((await fixture.exchange(expired.ticket)).status).toBe(400)
    expect(
      await testD1.d1
        .prepare(
          'SELECT status FROM impersonation_handoff_spike WHERE target_user_id = ?1 ORDER BY createdAt DESC LIMIT 1'
        )
        .bind(fixture.target.id)
        .first<{ readonly status: string }>()
    ).toEqual({ status: 'expired' })

    const mismatched = await fixture.issue()
    await testD1.d1
      .prepare(
        "UPDATE impersonation_handoff_spike SET merchant_id = 'mismatched-merchant' WHERE target_user_id = ?1 AND status = 'pending' AND merchant_origin = ?2"
      )
      .bind(fixture.target.id, merchantOrigin)
      .run()
    expect((await fixture.exchange(mismatched.ticket)).status).toBe(400)

    const partial = await fixture.issue()
    await testD1.d1
      .prepare(
        "UPDATE impersonation_handoff_spike SET status = 'active', merchant_session_id = 'missing-session' WHERE target_user_id = ?1 AND merchant_id = ?2 AND status = 'pending'"
      )
      .bind(fixture.target.id, fixture.merchantId)
      .run()
    expect((await fixture.exchange(partial.ticket)).status).toBe(400)
  })

  it('rejects a browser with a normal Merchant Session without modifying it', async () => {
    const fixture = await setup()
    const pending = await fixture.issue()
    const signIn = await fixture.callAuth(
      fixture.merchantAuth,
      merchantOrigin,
      '/sign-in/email',
      { email: fixture.targetEmail, password }
    )
    const normalCookie = cookiePair(signIn)
    const before = await fixture.merchantAuth.api.getSession({
      headers: new Headers({ cookie: normalCookie })
    })

    const rejected = await fixture.exchange(pending.ticket, normalCookie)
    expect(rejected.status).toBe(409)
    expect(rejected.headers.has('set-cookie')).toBe(false)
    const after = await fixture.merchantAuth.api.getSession({
      headers: new Headers({ cookie: normalCookie })
    })
    expect(after?.session.id).toBe(before?.session.id)
    expect(after?.session.impersonatedBy).toBeNull()

    expect((await fixture.exchange(pending.ticket)).status).toBe(303)
  })

  it('rolls the lifecycle transition back when Better Auth session persistence fails', async () => {
    const duplicateSessionId = crypto.randomUUID()
    const fixture = await setup({ sessionId: () => duplicateSessionId })
    const timestamp = Math.floor(Date.now() / 1_000)
    await fixture.db.insert(session).values({
      id: duplicateSessionId,
      token: crypto.randomUUID(),
      userId: fixture.target.id,
      expiresAt: new Date((timestamp + 3_600) * 1_000),
      createdAt: new Date(timestamp * 1_000),
      updatedAt: new Date(timestamp * 1_000)
    })
    const pending = await fixture.issue()

    const failed = await fixture.exchange(pending.ticket)
    expect(failed.status).toBe(503)
    expect(failed.headers.has('set-cookie')).toBe(false)
    const record = await testD1.d1
      .prepare(
        'SELECT status, merchant_session_id FROM impersonation_handoff_spike WHERE target_user_id = ?1 ORDER BY createdAt DESC LIMIT 1'
      )
      .bind(fixture.target.id)
      .first<{ readonly status: string; readonly merchant_session_id: string | null }>()
    expect(record).toEqual({ status: 'pending', merchant_session_id: null })
  })

  it('navigates a real browser across host-only Operations and Merchant cookie boundaries', async () => {
    let fixture: Awaited<ReturnType<typeof setup>> | undefined
    let browserTicket: string | undefined
    const browserTrace: string[] = []
    const server = createServer(async (incoming, outgoing) => {
      try {
        if (!fixture || !browserTicket) throw new Error('Fixture is not ready')
        const request = await toWebRequest(incoming)
        browserTrace.push(`${request.method} ${request.url}`)
        const url = new URL(request.url)
        if (url.hostname === 'localhost') {
          if (url.pathname === '/start') {
            await writeWebResponse(
              outgoing,
              new Response(
                `<form action="${fixture.merchantOrigin}/impersonation/handoffs/exchange" method="post"><input type="hidden" name="ticket" value="${browserTicket}"><button>Start</button></form>`,
                { headers: { 'content-type': 'text/html' } }
              )
            )
            return
          }
          await writeWebResponse(
            outgoing,
            new Response(`Stopped: ${url.searchParams.get('impersonation')}`, {
              headers: { 'content-type': 'text/plain' }
            })
          )
          return
        }
        if (request.method === 'GET' && url.pathname === '/') {
          await writeWebResponse(
            outgoing,
            new Response(
              `<form action="${fixture.merchantOrigin}/impersonation/stop" method="post"><button>Stop</button></form>`,
              { headers: { 'content-type': 'text/html' } }
            )
          )
          return
        }
        const response = await fixture.handoff.merchantHandler(request)
        browserTrace.push(`response ${response.status}`)
        await writeWebResponse(outgoing, response)
      } catch (error) {
        outgoing.statusCode = 500
        outgoing.end(error instanceof Error ? error.message : 'server error')
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test port')
    const browserOperationsOrigin = `http://localhost:${address.port}`
    const browserMerchantOrigin = `http://127.0.0.1:${address.port}`
    fixture = await setup({
      operationsOrigin: browserOperationsOrigin,
      merchantOrigin: browserMerchantOrigin,
      production: false
    })
    browserTicket = (await fixture.issue()).ticket

    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext()
      const [operationsCookieName, operationsCookieValue] =
        fixture.operationsCookie.split('=') as [string, string]
      await context.addCookies([
        {
          name: operationsCookieName,
          value: operationsCookieValue,
          url: browserOperationsOrigin,
          httpOnly: true,
          sameSite: 'Lax'
        }
      ])
      const page = await context.newPage()
      page.setDefaultTimeout(5_000)
      page.setDefaultNavigationTimeout(5_000)
      await page.goto(`${browserOperationsOrigin}/start`)
      await page.getByRole('button', { name: 'Start' }).click({ noWaitAfter: true })
      try {
        await page.waitForURL(`${browserMerchantOrigin}/`, { waitUntil: 'commit' })
      } catch {
        throw new Error(browserTrace.join('\n'))
      }
      expect(browserTrace).toContain(
        `POST ${browserMerchantOrigin}/impersonation/handoffs/exchange`
      )
      expect(browserTrace.some((entry) => entry.includes(browserTicket!))).toBe(false)

      const operationsCookies = await context.cookies(browserOperationsOrigin)
      const merchantCookies = await context.cookies(browserMerchantOrigin)
      expect(operationsCookies.map((cookie) => cookie.name)).toEqual([
        'operations.session_token'
      ])
      expect(operationsCookies[0]?.domain).toBe('localhost')
      expect(merchantCookies.map((cookie) => cookie.name)).toEqual([
        'merchant.session_token'
      ])
      expect(merchantCookies[0]?.domain).toBe('127.0.0.1')

      await page.getByRole('button', { name: 'Stop' }).click({ noWaitAfter: true })
      await page.waitForURL(
        `${browserOperationsOrigin}/merchants/${fixture.merchantId}/members/${fixture.target.id}?impersonation=stopped`,
        { waitUntil: 'commit' }
      )
      expect(await page.textContent('body')).toContain('Stopped: stopped')
      expect(await context.cookies(browserMerchantOrigin)).toEqual([])
      expect(
        (await context.cookies(browserOperationsOrigin)).map((cookie) => cookie.name)
      ).toEqual(['operations.session_token'])
    } finally {
      await browser.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }, 30_000)
})
