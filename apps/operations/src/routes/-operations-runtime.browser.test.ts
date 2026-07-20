import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, expect as browserExpect, type Browser } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { createOperationsAuth } from '@b2b-saas-starter/auth/operations'
import { createDb } from '@b2b-saas-starter/db/client'
import { provisionLocalD1 } from '@b2b-saas-starter/db/local-development'
import {
  auditEvents,
  impersonationRecords,
  merchantMemberships,
  merchants,
  operationsAuditEvents,
  operatorInvitations,
  session,
  user
} from '@b2b-saas-starter/db/schema'
import { eq } from 'drizzle-orm'
import { localOperatorFixture } from '@/lib/server/operations-worker.ts'

const merchantId = 'mer_tanstack_browser'
const memberId = 'mem_tanstack_browser'
const operatorId = 'opr_tanstack_browser'
const auditId = 'oaud_tanstack_browser'
const enrollmentEmail = 'tanstack-browser-enrollment@example.test'

describe('Operations real TanStack runtime', () => {
  let app: ViteDevServer
  let browser: Browser
  let origin: string

  beforeAll(async () => {
    const d1 = await provisionLocalD1()
    const db = createDb(d1)
    await db
      .delete(impersonationRecords)
      .where(eq(impersonationRecords.targetMemberId, memberId))
    await db.delete(operationsAuditEvents).where(eq(operationsAuditEvents.id, auditId))
    await db.delete(merchants).where(eq(merchants.id, merchantId))
    await db.delete(user).where(eq(user.id, memberId))
    await db.delete(user).where(eq(user.id, operatorId))
    const existingEnrollmentUsers = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, enrollmentEmail))
    for (const enrolled of existingEnrollmentUsers) {
      await db.delete(auditEvents).where(eq(auditEvents.actorUserId, enrolled.id))
      await db.delete(user).where(eq(user.id, enrolled.id))
    }
    await db
      .delete(operatorInvitations)
      .where(eq(operatorInvitations.email, enrollmentEmail))

    const now = new Date('2026-07-20T12:00:00.000Z')
    await db.insert(user).values([
      {
        id: memberId,
        email: 'tanstack-browser-member@example.test',
        name: 'TanStack Browser Member',
        emailVerified: true,
        identityClass: 'merchant_member',
        createdAt: now,
        updatedAt: now
      },
      {
        id: operatorId,
        email: 'tanstack-browser-operator@example.test',
        name: 'TanStack Browser Operator',
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'merchant-reader',
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(merchants).values({
      id: merchantId,
      publicName: 'TanStack Browser Studio',
      slug: 'tanstack-browser-studio',
      timezone: 'Europe/Bucharest',
      currency: 'RON',
      plan: 'solo',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(merchantMemberships).values({
      merchantId,
      userId: memberId,
      role: 'owner',
      createdAt: now.toISOString()
    })
    await db.insert(operationsAuditEvents).values({
      id: auditId,
      businessEventId: 'tanstack-browser:audit',
      actorOperatorId: localOperatorFixture.id,
      actorDisplayName: localOperatorFixture.name,
      targetId: memberId,
      targetDisplayName: 'TanStack Browser Member',
      merchantId,
      merchantDisplayName: 'TanStack Browser Studio',
      action: 'operations.tanstack_browser.proven',
      result: 'accepted',
      occurredAt: now.toISOString(),
      retentionPolicy: 'operations-standard',
      retainUntil: null,
      internalReason: 'Real hydrated route proof',
      supportReference: 'OPS-TANSTACK-BROWSER',
      createdAt: now.toISOString()
    })

    app = await createServer({
      configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
      server: { host: '127.0.0.1', port: 0, strictPort: false }
    })
    await app.listen()
    origin = app.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? ''
    if (!origin) throw new Error('Vite did not expose a local Operations URL')
    browser = await chromium.launch({ headless: true })
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
    await app?.close()
    const db = createDb(await provisionLocalD1())
    await db
      .delete(impersonationRecords)
      .where(eq(impersonationRecords.targetMemberId, memberId))
    await db.delete(operationsAuditEvents).where(eq(operationsAuditEvents.id, auditId))
    await db.delete(merchants).where(eq(merchants.id, merchantId))
    await db.delete(user).where(eq(user.id, memberId))
    await db.delete(user).where(eq(user.id, operatorId))
    const enrolledUsers = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, enrollmentEmail))
    for (const enrolled of enrolledUsers) {
      await db.delete(auditEvents).where(eq(auditEvents.actorUserId, enrolled.id))
      await db.delete(user).where(eq(user.id, enrolled.id))
    }
    await db
      .delete(operatorInvitations)
      .where(eq(operatorInvitations.email, enrollmentEmail))
  })

  it('drives authenticated discovery, management, and audit through hydrated routes', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${origin}/sign-in`)
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Email').fill(localOperatorFixture.email)
    await page.getByLabel('Password').fill(localOperatorFixture.password)
    await page.getByRole('button', { name: 'Continue' }).click()
    await browserExpect(page).toHaveURL(`${origin}/verify-totp`)

    const auth = createOperationsAuth({
      db: createDb(await provisionLocalD1()),
      secret: 'development-operations-auth-secret-change-me',
      baseURL: origin,
      trustedOrigins: [origin],
      production: false,
      securityContact: 'security@example.test'
    })
    const { code } = await auth.api.generateTOTP({
      body: { secret: localOperatorFixture.totpSecret }
    })
    await page.getByLabel('Authentication code').fill(code)
    await page.getByRole('button', { name: 'Verify and continue' }).click()
    await browserExpect(
      page.getByRole('heading', { name: `Welcome, ${localOperatorFixture.name}` })
    ).toBeVisible()

    await page.getByLabel('Find Merchants').fill('tanstack-browser-studio')
    await page.getByRole('button', { name: 'Search', exact: true }).first().click()
    await page.waitForLoadState('networkidle')
    await browserExpect(
      page.getByRole('link', { name: 'TanStack Browser Studio' })
    ).toBeVisible()
    await page.getByRole('link', { name: 'TanStack Browser Studio' }).click()
    await page.waitForLoadState('networkidle')
    await page.getByRole('link', { name: 'TanStack Browser Member' }).click()
    await page.waitForLoadState('networkidle')
    await page
      .getByLabel('Internal Impersonation Reason')
      .fill('Verify the real TanStack handoff boundary')
    const fresh = await auth.api.generateTOTP({
      body: { secret: localOperatorFixture.totpSecret }
    })
    await page.getByLabel('Current authentication code').fill(fresh.code)
    await page.getByRole('button', { name: 'Create Pending Handoff' }).click()
    await browserExpect(page.getByText(/Pending Handoff created/)).toBeVisible()
    expect(page.url()).not.toContain('ticket')
    expect(
      (await page.locator('input[name="ticket"]').inputValue()).length
    ).toBeGreaterThan(32)

    await page.getByRole('link', { name: 'Operators' }).click()
    const stale = await context.newPage()
    await stale.goto(`${origin}/operators`)
    await stale.waitForLoadState('networkidle')
    const operator = page.locator('article').filter({
      has: page.getByText('TanStack Browser Operator')
    })
    const previousUpdatedAt = await operator
      .locator('input[name="expectedUpdatedAt"]')
      .first()
      .inputValue()
    await operator.getByLabel('impersonation-auditor').check()
    await operator.getByRole('button', { name: 'Save roles' }).click()
    await browserExpect(page.getByText(/Operator roles updated/i)).toBeVisible()
    await browserExpect
      .poll(() =>
        operator.locator('input[name="expectedUpdatedAt"]').first().inputValue()
      )
      .not.toBe(previousUpdatedAt)

    const staleOperator = stale.locator('article').filter({
      has: stale.getByText('TanStack Browser Operator')
    })
    await staleOperator.getByRole('button', { name: 'Disable operator' }).click()
    await browserExpect(stale.getByRole('alert')).toContainText(
      'Authoritative state changed'
    )
    expect(stale.url()).not.toContain('error=')
    expect(stale.url()).not.toContain('stale')

    await page.goto(`${origin}/operators/invitations/new`)
    await page.getByLabel('Dedicated operator email').fill(enrollmentEmail)
    await page.getByLabel('merchant-reader').check()
    await page.getByRole('button', { name: 'Send single-use invitation' }).click()
    await browserExpect(
      page.getByText(new RegExp(`Invitation sent to ${enrollmentEmail}`))
    ).toBeVisible()
    const captureResponse = await page.request.get(
      `${origin}/__local/operator-invitation-email`
    )
    expect(captureResponse.ok()).toBe(true)
    const capture = (await captureResponse.json()) as {
      readonly email: string
      readonly url: string
    }
    expect(capture.email).toBe(enrollmentEmail)

    const recipientContext = await browser.newContext()
    const recipient = await recipientContext.newPage()
    const enrollmentUrl = new URL(capture.url)
    enrollmentUrl.protocol = new URL(origin).protocol
    enrollmentUrl.host = new URL(origin).host
    await recipient.goto(enrollmentUrl.toString())
    await recipient.waitForLoadState('networkidle')
    await recipient.getByLabel('Name').fill('TanStack Enrolled Operator')
    await recipient
      .getByLabel('Password (at least 12 characters)')
      .fill('tanstack-enrollment-password')
    await recipient.getByRole('button', { name: 'Begin security enrollment' }).click()
    await browserExpect(recipient).toHaveURL(`${origin}/enroll/security`)
    await recipient.waitForLoadState('networkidle')
    await recipient.getByLabel('Confirm password').fill('tanstack-enrollment-password')
    await recipient.getByRole('button', { name: 'Set up authenticator' }).click()
    await browserExpect(
      recipient.getByRole('heading', { name: 'Confirm operator security' })
    ).toBeVisible()
    const totpURI = await recipient
      .locator('p')
      .filter({ hasText: 'otpauth://' })
      .textContent()
    const enrollmentSecret = new URL(totpURI!).searchParams.get('secret')
    expect(enrollmentSecret).toBeTruthy()
    const enrollmentCode = await auth.api.generateTOTP({
      body: { secret: enrollmentSecret! }
    })
    await recipient.getByLabel('Authentication code').fill(enrollmentCode.code)
    await recipient.getByLabel('I stored my backup codes').check()
    await recipient.getByRole('button', { name: 'Complete enrollment' }).click()
    await browserExpect(recipient).toHaveURL(
      `${origin}/sign-in?result=enrollment-complete`
    )
    await recipientContext.close()

    await page.getByRole('link', { name: 'Audit' }).click()
    await page.getByLabel('Action').fill('operations.tanstack_browser.proven')
    await page.getByRole('button', { name: 'Filter audit' }).click()
    await browserExpect(
      page.getByRole('link', { name: 'operations.tanstack_browser.proven' })
    ).toBeVisible()

    const db = createDb(await provisionLocalD1())
    await db
      .update(user)
      .set({ role: 'merchant-impersonator,operator-manager' })
      .where(eq(user.id, localOperatorFixture.id))
    try {
      await page.goto(`${origin}/audit?action=operations.tanstack_browser.proven`)
      await browserExpect(
        page.getByRole('heading', { name: 'Permission required' })
      ).toBeVisible()
    } finally {
      await db
        .update(user)
        .set({ role: localOperatorFixture.roles.join(',') })
        .where(eq(user.id, localOperatorFixture.id))
    }

    const sessionResponse = await page.request.get(`${origin}/api/operations/session`)
    const sessionBody = (await sessionResponse.json()) as {
      readonly principal: { readonly sessionId: string }
    }
    await db.delete(session).where(eq(session.id, sessionBody.principal.sessionId))
    await page.goto(`${origin}/operators`)
    await browserExpect(page).toHaveURL(`${origin}/sign-in`)
    await context.close()
  }, 60_000)
})
