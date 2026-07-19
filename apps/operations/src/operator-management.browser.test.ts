import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, expect as browserExpect, type Browser } from '@playwright/test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createOperationsAuth } from '@b2b-saas-starter/auth/operations'
import { createDb } from '@b2b-saas-starter/db/client'
import { user } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  createOperationsWorker,
  localOperatorFixture,
  type OperationsWorkerEnv
} from './index.ts'

const secret = 'operations-management-browser-secret-at-least-thirty-two-bytes'

const toWebRequest = async (request: IncomingMessage): Promise<Request> => {
  const chunks: Buffer[] = []
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
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

describe('Operator management browser boundary', () => {
  let testD1: TestD1
  let browser: Browser
  let origin: string
  let closeServer: () => Promise<void>

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    const worker = createOperationsWorker()
    let env: OperationsWorkerEnv
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

  it('composes roles, denies self-change, revokes, and rejects stale state', async () => {
    const db = createDb(testD1.d1)
    const targetId = `opr_ui_${crypto.randomUUID()}`
    const createdAt = new Date()
    await db.insert(user).values({
      id: targetId,
      email: `${targetId}@example.test`,
      name: 'UI Support Operator',
      emailVerified: true,
      twoFactorEnabled: true,
      identityClass: 'system_operator',
      role: 'merchant-reader',
      createdAt,
      updatedAt: createdAt
    })

    const context = await browser.newContext()
    const first = await context.newPage()
    await first.goto(`${origin}/sign-in`)
    await first.getByLabel('Email').fill(localOperatorFixture.email)
    await first.getByLabel('Password').fill(localOperatorFixture.password)
    await first.getByRole('button', { name: 'Continue' }).click()
    const auth = createOperationsAuth({
      db,
      secret,
      baseURL: origin,
      trustedOrigins: [origin],
      production: false,
      securityContact: 'security@example.test'
    })
    const { code } = await auth.api.generateTOTP({
      body: { secret: localOperatorFixture.totpSecret }
    })
    await first.getByLabel('Authentication code').fill(code)
    await first.getByRole('button', { name: 'Verify' }).click()
    await first.goto(`${origin}/operators`)

    const stale = await context.newPage()
    await stale.goto(`${origin}/operators`)
    const firstRow = first.getByRole('row', { name: /UI Support Operator/ })
    await firstRow.getByLabel('Impersonation Auditor').check()
    await firstRow.getByRole('button', { name: 'Save roles' }).click()
    await browserExpect(first.getByText('Operator roles updated')).toBeVisible()

    await stale
      .getByRole('row', { name: /UI Support Operator/ })
      .getByRole('button', { name: 'Disable' })
      .click()
    await browserExpect(
      stale.getByText('operator management page is stale')
    ).toBeVisible()
    const selfRow = stale.getByRole('row', { name: /Local System Operator/ })
    await browserExpect(
      selfRow.getByText('Manage your own account through another Operator Manager.')
    ).toBeVisible()
    await browserExpect(
      selfRow.getByRole('button', { name: 'Save roles' })
    ).toHaveCount(0)

    await stale.reload()
    await stale
      .getByRole('row', { name: /UI Support Operator/ })
      .getByRole('button', { name: 'Disable' })
      .click()
    await browserExpect(stale.getByText('Operator enabled state updated')).toBeVisible()
    await browserExpect(
      stale
        .getByRole('row', { name: /UI Support Operator/ })
        .getByRole('cell', { name: 'Disabled', exact: true })
    ).toBeVisible()
    expect(await context.cookies(origin)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'operations.session_token' })
      ])
    )
    await context.close()
  }, 20_000)
})
