import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, expect as browserExpect, type Browser } from '@playwright/test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createDb } from '@b2b-saas-starter/db/client'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
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
})
