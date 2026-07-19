import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, expect as browserExpect, type Browser } from '@playwright/test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createDb } from '@b2b-saas-starter/db/client'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  merchantMemberships,
  merchants,
  publicBookingPages,
  user
} from '@b2b-saas-starter/db/schema'
import { eq } from 'drizzle-orm'
import { createOperationsAuth } from '@b2b-saas-starter/auth/operations'
import { createOperationsWorker, localOperatorFixture } from './index.ts'
import type { OperationsWorkerEnv } from './index.ts'

const secret = 'operations-browser-secret-that-is-at-least-thirty-two-bytes'

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
  response.headers
    .getSetCookie()
    .forEach((cookie) => target.appendHeader('set-cookie', cookie))
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') target.setHeader(name, value)
  })
  target.end(Buffer.from(await response.arrayBuffer()))
}

describe('Operations browser boundary', () => {
  let testD1: TestD1
  let browser: Browser
  let origin: string
  let closeServer: () => Promise<void>
  let env: OperationsWorkerEnv

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    const worker = createOperationsWorker()
    const server = createServer(async (request, response) => {
      await writeWebResponse(
        response,
        await worker.fetch(await toWebRequest(request), env)
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('missing server address')
    origin = `http://127.0.0.1:${address.port}`
    env = {
      DB: testD1.d1,
      OPERATIONS_AUTH_SECRET: secret,
      OPERATIONS_APP_ORIGIN: origin,
      OPERATIONS_AUTH_TRUSTED_ORIGINS: origin,
      OPERATIONS_LOCAL_SEED: 'enabled',
      ENVIRONMENT: 'development'
    }
    const db = createDb(testD1.d1)
    const now = new Date('2026-07-19T09:00:00.000Z')
    await db.insert(user).values({
      id: 'mem_browser_target',
      email: 'target@example.test',
      name: 'Browser Target',
      emailVerified: true,
      identityClass: 'merchant_member',
      createdAt: now,
      updatedAt: now
    })
    await db.insert(merchants).values({
      id: 'mer_browser_studio',
      publicName: 'Browser Booking Studio',
      slug: 'browser-studio',
      timezone: 'Europe/Bucharest',
      currency: 'RON',
      plan: 'solo',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(merchantMemberships).values({
      merchantId: 'mer_browser_studio',
      userId: 'mem_browser_target',
      role: 'owner',
      createdAt: now.toISOString()
    })
    await db.insert(publicBookingPages).values({
      id: 'pbp_browser_studio',
      merchantId: 'mer_browser_studio',
      status: 'published',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(user).values({
      id: 'mem_browser_disabled',
      email: 'disabled-browser@example.test',
      name: 'Disabled Browser Target',
      emailVerified: true,
      identityClass: 'merchant_member',
      banned: true,
      createdAt: now,
      updatedAt: now
    })
    await db.insert(merchants).values({
      id: 'mer_browser_disabled',
      publicName: 'Disabled Browser Studio',
      slug: 'disabled-browser-studio',
      timezone: 'Europe/Bucharest',
      currency: 'RON',
      plan: 'solo',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(merchantMemberships).values({
      merchantId: 'mer_browser_disabled',
      userId: 'mem_browser_disabled',
      role: 'owner',
      createdAt: now.toISOString()
    })
    closeServer = () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    browser = await chromium.launch({ headless: true })
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
    await closeServer?.()
    await testD1?.dispose()
  })

  it('requires password and TOTP before showing the protected shell', async () => {
    const page = await browser.newPage()
    await page.goto(origin)
    await browserExpect(page).toHaveURL(`${origin}/sign-in`)
    await page.getByLabel('Email').fill(localOperatorFixture.email)
    await page.getByLabel('Password').fill(localOperatorFixture.password)
    await page.getByRole('button', { name: 'Continue' }).click()
    await browserExpect(page).toHaveURL(`${origin}/verify-totp`)

    const auth = createOperationsAuth({
      db: createDb(testD1.d1),
      secret,
      baseURL: origin,
      trustedOrigins: [origin],
      production: false
    })
    const { code } = await auth.api.generateTOTP({
      body: { secret: localOperatorFixture.totpSecret }
    })
    await page.getByLabel('Authentication code').fill(code)
    await page.getByRole('button', { name: 'Verify' }).click()
    await browserExpect(page).toHaveURL(`${origin}/`)
    await browserExpect(page.getByText('Protected Operations shell')).toBeVisible()
    await browserExpect(page.getByText(localOperatorFixture.email)).toBeVisible()

    const cookies = await page.context().cookies(origin)
    expect(cookies.some((cookie) => cookie.name === 'operations.session_token')).toBe(
      true
    )
    expect(cookies.some((cookie) => cookie.name.startsWith('merchant.'))).toBe(false)
    await page.close()
  })

  it('denies stock Better Auth endpoints and ignores a Merchant cookie', async () => {
    const context = await browser.newContext()
    await context.addCookies([
      { name: 'merchant.session_token', value: 'not-an-operator', url: origin }
    ])
    const page = await context.newPage()
    await page.goto(origin)
    await browserExpect(page).toHaveURL(`${origin}/sign-in`)
    const stock = await page.request.post(`${origin}/api/auth/admin/list-users`, {
      data: {}
    })
    expect(stock.status()).toBe(404)
    const signup = await page.request.post(`${origin}/api/auth/sign-up/email`, {
      data: {
        email: 'public@example.test',
        password: 'public-signup-is-disabled',
        name: 'Public Signup'
      }
    })
    expect(signup.status()).toBe(404)
    await context.close()
  })

  it('searches from the protected UI and shows current Merchant Member eligibility', async () => {
    const page = await browser.newPage()
    await page.goto(`${origin}/sign-in`)
    await page.getByLabel('Email').fill(localOperatorFixture.email)
    await page.getByLabel('Password').fill(localOperatorFixture.password)
    await page.getByRole('button', { name: 'Continue' }).click()
    const auth = createOperationsAuth({
      db: createDb(testD1.d1),
      secret,
      baseURL: origin,
      trustedOrigins: [origin],
      production: false
    })
    const { code } = await auth.api.generateTOTP({
      body: { secret: localOperatorFixture.totpSecret }
    })
    await page.getByLabel('Authentication code').fill(code)
    await page.getByRole('button', { name: 'Verify' }).click()

    await page.getByLabel('Find merchants').fill('browser')
    await page.getByRole('button', { name: 'Search merchants' }).click()
    await page.getByRole('link', { name: 'Browser Booking Studio' }).click()
    await browserExpect(
      page.getByRole('heading', { name: 'Browser Booking Studio' })
    ).toBeVisible()
    await browserExpect(
      page.getByText('Published at /browser-studio/booking')
    ).toBeVisible()
    await browserExpect(
      page.getByText('Incomplete: active-service, eligible-provider, schedule-rules')
    ).toBeVisible()

    await page.getByRole('link', { name: 'Browser Target' }).click()
    await browserExpect(
      page.getByRole('heading', { name: 'Browser Target' })
    ).toBeVisible()
    await browserExpect(page.getByText('target@example.test')).toBeVisible()
    await browserExpect(page.getByText('Eligible for impersonation')).toBeVisible()

    const detailResponse = await page.request.get(
      `${origin}/api/merchants/mer_browser_studio/members/mem_browser_target`
    )
    const detailBody = await detailResponse.text()
    expect(detailResponse.status()).toBe(200)
    expect(detailBody).not.toMatch(/token|password|secret|backup/i)

    await page.goto(origin)
    await page.getByLabel('Find merchant members').fill('target@example.test')
    await page.getByRole('button', { name: 'Search members' }).click()
    await page.getByRole('link', { name: 'Browser Target' }).click()
    await browserExpect(page.getByText('Eligible for impersonation')).toBeVisible()

    await page.goto(`${origin}/?memberQuery=nobody`)
    await browserExpect(page.getByText('No Merchant Members found.')).toBeVisible()

    await page.goto(`${origin}/?memberQuery=disabled-browser%40example.test`)
    await page.getByRole('link', { name: 'Disabled Browser Target' }).click()
    await browserExpect(
      page.getByText('Ineligible for impersonation: member-disabled')
    ).toBeVisible()

    const db = createDb(testD1.d1)
    await db.update(user).set({ banned: true }).where(eq(user.id, 'mem_browser_target'))
    await page.goto(`${origin}/merchants/mer_browser_studio/members/mem_browser_target`)
    await browserExpect(
      page.getByText('Ineligible for impersonation: member-disabled')
    ).toBeVisible()
    await db
      .update(user)
      .set({ banned: false })
      .where(eq(user.id, 'mem_browser_target'))
    await page.close()
  }, 20_000)
})
