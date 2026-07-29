import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, expect as browserExpect, type Browser } from '@playwright/test'
import type { D1Database } from '@cloudflare/workers-types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import {
  createOperationsAuth,
  provisionLocalOperator
} from '@b2b-saas-starter/auth/operations'
import { createDb } from '@b2b-saas-starter/db/client'
import { applyMigrations } from '@b2b-saas-starter/db/testing'
import {
  merchantMemberships,
  merchants,
  operationsAuditEvents,
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
  let db: ReturnType<typeof createDb>
  let disposeD1: () => Promise<void>
  let testStatePath: string
  let origin: string
  let authSecret: string

  beforeAll(async () => {
    testStatePath = await mkdtemp(join(tmpdir(), 'operations-browser-test-'))
    process.env.OPERATIONS_BROWSER_TEST_D1_PATH = testStatePath
    app = await createServer({
      configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
      mode: 'operations-browser-test',
      server: { host: '127.0.0.1', port: 0, strictPort: false }
    })
    await app.listen()
    origin = app.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? ''
    if (!origin) throw new Error('Vite did not expose a local Operations URL')
    const bindings = (await app.ssrLoadModule('cloudflare:workers')) as {
      readonly env: {
        readonly DB: D1Database
        readonly OPERATIONS_AUTH_SECRET: string
      }
      readonly disposeBrowserTestD1: () => Promise<void>
    }
    db = createDb(bindings.env.DB)
    authSecret = bindings.env.OPERATIONS_AUTH_SECRET
    disposeD1 = bindings.disposeBrowserTestD1
    await applyMigrations(bindings.env.DB)
    await provisionLocalOperator({
      db,
      secret: authSecret,
      mode: 'test',
      operator: localOperatorFixture
    })

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
    browser = await chromium.launch({ headless: true })
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
    await app?.close()
    await disposeD1?.()
    delete process.env.OPERATIONS_BROWSER_TEST_D1_PATH
    if (testStatePath) await rm(testStatePath, { recursive: true, force: true })
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
      db,
      secret: authSecret,
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
    await operator.getByLabel('Messaging Reconciler').check()
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
    await page.getByLabel('Messaging Reader').check()
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
