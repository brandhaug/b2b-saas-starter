import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, expect as browserExpect, type Browser } from '@playwright/test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createDb } from '@b2b-saas-starter/db/client'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  impersonationRecords,
  merchantMemberships,
  merchants,
  operatorEnrollments,
  operationsAuditEvents,
  publicBookingPages,
  twoFactor,
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
  const invitationLinks: string[] = []

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
      ENVIRONMENT: 'development',
      CLOUDFLARE_EMAIL_FROM: 'operations@example.test',
      EMAIL: {
        send: async (message) => {
          const link = message.text.match(/https?:\/\/\S+/)?.[0]
          if (link) invitationLinks.push(link)
        }
      }
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
    await db.insert(operationsAuditEvents).values({
      id: 'oaud_browser_activation',
      businessEventId: 'browser:impersonation:activated',
      actorOperatorId: localOperatorFixture.id,
      actorDisplayName: localOperatorFixture.name,
      targetId: 'mem_browser_target',
      targetDisplayName: 'Browser Target',
      merchantId: 'mer_browser_studio',
      merchantDisplayName: 'Browser Booking Studio',
      action: 'impersonation.activated',
      result: 'accepted',
      occurredAt: now.toISOString(),
      retentionPolicy: 'impersonation-two-years',
      retainUntil: '2028-07-19T09:00:00.000Z',
      internalReason: 'Investigate private scheduling failure',
      supportReference: 'SUP-BROWSER-42',
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

  it('invites and enrolls a dedicated operator without permission escape', async () => {
    const manager = await browser.newPage()
    await manager.goto(`${origin}/sign-in`)
    await manager.getByLabel('Email').fill(localOperatorFixture.email)
    await manager.getByLabel('Password').fill(localOperatorFixture.password)
    await manager.getByRole('button', { name: 'Continue' }).click()
    const auth = createOperationsAuth({
      db: createDb(testD1.d1),
      secret,
      baseURL: origin,
      trustedOrigins: [origin],
      production: false
    })
    const managerCode = await auth.api.generateTOTP({
      body: { secret: localOperatorFixture.totpSecret }
    })
    await manager.getByLabel('Authentication code').fill(managerCode.code)
    await manager.getByRole('button', { name: 'Verify' }).click()
    await manager.goto(`${origin}/operators`)
    await manager.getByRole('link', { name: 'Invite System Operator' }).click()
    const email = `invited-${crypto.randomUUID()}@example.test`
    const password = 'enrollment-password-strong'
    await manager.getByLabel('Email').fill(email)
    await manager.getByLabel('merchant-reader').check()
    await manager.getByRole('button', { name: 'Create invitation' }).click()
    const invitationLink = invitationLinks.at(-1)
    expect(invitationLink).toContain('/enroll?token=')

    const recipientContext = await browser.newContext()
    const recipient = await recipientContext.newPage()
    await recipient.goto(invitationLink!)
    await recipient.getByLabel('Name').fill('Invited Operator')
    await recipient.getByLabel('Password').fill(password)
    await recipient.getByRole('button', { name: 'Begin security enrollment' }).click()
    await browserExpect(recipient).toHaveURL(`${origin}/enroll/security`)
    await browserExpect(
      recipient.getByText('This enrollment-only session has no Operations permissions.')
    ).toBeVisible()

    const escapeAttempt = await recipientContext.newPage()
    await escapeAttempt.goto(origin)
    await browserExpect(escapeAttempt).toHaveURL(`${origin}/sign-in`)
    await escapeAttempt.close()

    await recipient.getByLabel('Confirm password').fill(password)
    await recipient
      .getByRole('button', { name: 'Set up authenticator and backup codes' })
      .click({ timeout: 5_000 })
    const totpURI = await recipient.locator('p code').textContent()
    const displayedBackupCodes = await recipient.locator('li code').allTextContents()
    const totpSecret = new URL(totpURI!).searchParams.get('secret')
    expect(totpSecret).toBeTruthy()
    const db = createDb(testD1.d1)
    const [invited] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1)
    const [storedFactor] = await db
      .select({ backupCodes: twoFactor.backupCodes })
      .from(twoFactor)
      .where(eq(twoFactor.userId, invited!.id))
      .limit(1)
    for (const code of displayedBackupCodes) {
      expect(storedFactor?.backupCodes).not.toContain(code)
    }
    const enrollmentCode = await auth.api.generateTOTP({
      body: { secret: totpSecret! }
    })
    await recipient.getByLabel('Authentication code').fill(enrollmentCode.code)
    await recipient.getByLabel('I stored my backup codes').check()
    await recipient
      .getByRole('button', { name: 'Complete enrollment' })
      .click({ timeout: 5_000 })
    await browserExpect(recipient).toHaveURL(
      `${origin}/sign-in?result=enrollment-complete`
    )

    await recipient.getByLabel('Email').fill(email)
    await recipient.getByLabel('Password').fill(password)
    await recipient.getByRole('button', { name: 'Continue' }).click({ timeout: 5_000 })
    await browserExpect(recipient).toHaveURL(`${origin}/verify-totp`)
    const signInCode = await auth.api.generateTOTP({
      body: { secret: totpSecret! }
    })
    await recipient.getByLabel('Authentication code').fill(signInCode.code)
    await recipient.getByRole('button', { name: 'Verify' }).click({ timeout: 5_000 })
    await browserExpect(recipient).toHaveURL(`${origin}/`)
    await browserExpect(recipient.getByText('Protected Operations shell')).toBeVisible()

    await recipientContext.close()
    await manager.close()
  }, 30_000)

  it('resumes expired enrollment after password sign-in without another invitation', async () => {
    const manager = await browser.newPage()
    await manager.goto(`${origin}/sign-in`)
    await manager.getByLabel('Email').fill(localOperatorFixture.email)
    await manager.getByLabel('Password').fill(localOperatorFixture.password)
    await manager.getByRole('button', { name: 'Continue' }).click()
    const auth = createOperationsAuth({
      db: createDb(testD1.d1),
      secret,
      baseURL: origin,
      trustedOrigins: [origin],
      production: false
    })
    const managerCode = await auth.api.generateTOTP({
      body: { secret: localOperatorFixture.totpSecret }
    })
    await manager.getByLabel('Authentication code').fill(managerCode.code)
    await manager.getByRole('button', { name: 'Verify' }).click()
    await manager.goto(`${origin}/operators/invitations/new`)
    const email = `interrupted-${crypto.randomUUID()}@example.test`
    const password = 'interrupted-password-strong'
    await manager.getByLabel('Email').fill(email)
    await manager.getByLabel('merchant-reader').check()
    await manager.getByRole('button', { name: 'Create invitation' }).click()
    const invitationLink = invitationLinks.at(-1)

    const recipient = await browser.newPage()
    await recipient.goto(invitationLink!)
    await recipient.getByLabel('Name').fill('Interrupted Operator')
    await recipient.getByLabel('Password').fill(password)
    await recipient.getByRole('button', { name: 'Begin security enrollment' }).click()
    const db = createDb(testD1.d1)
    const [interrupted] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1)
    await db
      .update(operatorEnrollments)
      .set({ sessionExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(operatorEnrollments.operatorId, interrupted!.id))

    await recipient.goto(`${origin}/sign-in`)
    await recipient.getByLabel('Email').fill(email)
    await recipient.getByLabel('Password').fill(password)
    await recipient.getByRole('button', { name: 'Continue' }).click()
    await browserExpect(recipient).toHaveURL(`${origin}/enroll/security`)
    await browserExpect(recipient.getByLabel('Confirm password')).toBeVisible()
    await recipient.getByRole('button', { name: 'Sign out of enrollment' }).click()
    await browserExpect(recipient).toHaveURL(`${origin}/sign-in`)
    expect(
      (await recipient.context().cookies(origin)).some(
        (cookie) => cookie.name === 'operations.enrollment'
      )
    ).toBe(false)
    await recipient.close()
    await manager.close()
  }, 30_000)

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
    await browserExpect(
      page.getByRole('heading', { name: 'Create accountable pending handoff' })
    ).toHaveCount(0)

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

  it('creates a recent-TOTP pending handoff from eligible Member detail without putting the ticket in the URL', async () => {
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

    await page.goto(`${origin}/merchants/mer_browser_studio/members/mem_browser_target`)
    await page
      .getByLabel('Internal Impersonation Reason')
      .fill('Reproduce a browser-reported scheduling issue')
    await page.getByLabel('External support reference').fill('SUP-BROWSER-START')
    const fresh = await auth.api.generateTOTP({
      body: { secret: localOperatorFixture.totpSecret }
    })
    await page.getByLabel('Current authentication code').fill(fresh.code)
    await page.getByRole('button', { name: 'Create pending handoff' }).click()

    await browserExpect(
      page.getByRole('heading', { name: 'Pending Handoff created' })
    ).toBeVisible()
    expect(page.url()).not.toContain('ticket')
    expect(page.url()).not.toContain('SUP-BROWSER-START')
    const plaintext = await page.locator('input[name="ticket"]').inputValue()
    expect(plaintext.length).toBeGreaterThan(32)
    const db = createDb(testD1.d1)
    const [record] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.targetMemberId, 'mem_browser_target'))
    expect(record).toMatchObject({
      lifecycle: 'pending-handoff',
      reason: 'Reproduce a browser-reported scheduling issue',
      supportReference: 'SUP-BROWSER-START'
    })
    expect(record?.ticketHash).not.toBe(plaintext)
    expect(JSON.stringify(record)).not.toContain(plaintext)
    await page.close()
  }, 20_000)

  it('rechecks permission after Member detail is rendered and rejects a stale start', async () => {
    const page = await browser.newPage()
    await page.goto(`${origin}/sign-in`)
    await page.getByLabel('Email').fill(localOperatorFixture.email)
    await page.getByLabel('Password').fill(localOperatorFixture.password)
    await page.getByRole('button', { name: 'Continue' }).click()
    const db = createDb(testD1.d1)
    const auth = createOperationsAuth({
      db,
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
    await db
      .update(impersonationRecords)
      .set({
        lifecycle: 'stopped',
        terminalAt: new Date(),
        updatedAt: new Date().toISOString()
      })
      .where(eq(impersonationRecords.targetMemberId, 'mem_browser_target'))

    await page.goto(`${origin}/merchants/mer_browser_studio/members/mem_browser_target`)
    await browserExpect(
      page.getByRole('heading', { name: 'Create accountable pending handoff' })
    ).toBeVisible()
    await page.getByLabel('Internal Impersonation Reason').fill('Stale role proof')
    const fresh = await auth.api.generateTOTP({
      body: { secret: localOperatorFixture.totpSecret }
    })
    await page.getByLabel('Current authentication code').fill(fresh.code)
    await db
      .update(user)
      .set({ role: 'impersonation-auditor,operator-manager' })
      .where(eq(user.id, localOperatorFixture.id))
    await page.getByRole('button', { name: 'Create pending handoff' }).click()
    await browserExpect(
      page.getByRole('heading', { name: 'Unable to create pending handoff' })
    ).toBeVisible()
    expect(
      await db
        .select()
        .from(impersonationRecords)
        .where(eq(impersonationRecords.lifecycle, 'pending-handoff'))
    ).toEqual([])
    await db
      .update(user)
      .set({ role: localOperatorFixture.roles.join(',') })
      .where(eq(user.id, localOperatorFixture.id))
    await page.close()
  }, 20_000)

  it('filters global evidence, protects detail, and rechecks audit permission', async () => {
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

    await page.getByRole('link', { name: 'Review global Operations audit' }).click()
    await page.getByLabel('Action').fill('impersonation.activated')
    await page.getByRole('button', { name: 'Filter audit' }).click()
    await browserExpect(
      page.getByRole('link', { name: 'impersonation.activated' })
    ).toBeVisible()
    expect(await page.locator('body').textContent()).not.toContain(
      'Investigate private scheduling failure'
    )
    expect(await page.locator('body').textContent()).not.toContain('SUP-BROWSER-42')

    await page.getByRole('link', { name: 'impersonation.activated' }).click()
    await browserExpect(
      page.getByText('Investigate private scheduling failure')
    ).toBeVisible()
    await browserExpect(page.getByText('SUP-BROWSER-42')).toBeVisible()
    await browserExpect(
      page.getByText('Two years, through 2028-07-19T09:00:00.000Z')
    ).toBeVisible()

    const db = createDb(testD1.d1)
    await db
      .update(user)
      .set({ role: 'merchant-impersonator,operator-manager' })
      .where(eq(user.id, localOperatorFixture.id))
    const denied = await page.goto(`${origin}/audit`)
    expect(denied?.status()).toBe(403)
    await db
      .update(user)
      .set({ role: localOperatorFixture.roles.join(',') })
      .where(eq(user.id, localOperatorFixture.id))
    await page.close()
  })
})
