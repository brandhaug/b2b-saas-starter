import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, expect as browserExpect, type Browser } from '@playwright/test'
import { createServer as createHttpServer } from 'node:http'
import { join } from 'node:path'
import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { createServer as createViteServer, type Plugin } from 'vite'
import { makeSignature } from 'better-auth/crypto'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  impersonationRecords,
  merchants,
  operationsNotificationIntents,
  session,
  user
} from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  OperationsImpersonationLifecycle,
  makeOperationsImpersonationLifecycleLayer
} from '@b2b-saas-starter/capabilities/operations'
import {
  clearImpersonationCookie,
  resolveMerchantImpersonationLifecycle,
  verifiedMerchantSessionToken
} from './lib/server/impersonation-lifecycle.ts'

const secret = 'merchant-browser-secret-that-is-at-least-thirty-two-characters'
const securityContact = 'security@example.test'

describe('Merchant impersonation lifecycle browser boundary', () => {
  let testD1: TestD1
  let db: ReturnType<typeof createDb>
  let browser: Browser
  let origin: string
  let closeServer: () => Promise<void>

  const runLifecycle = <A>(
    use: (
      lifecycle: OperationsImpersonationLifecycle['Service']
    ) => Effect.Effect<A, unknown>
  ) =>
    Effect.runPromise(
      Effect.flatMap(OperationsImpersonationLifecycle, use).pipe(
        Effect.provide(
          makeOperationsImpersonationLifecycleLayer(db, {
            securityContact
          })
        )
      )
    )

  const presentedSession = async (request: import('node:http').IncomingMessage) => {
    const token = await verifiedMerchantSessionToken({
      cookie: request.headers.cookie ?? '',
      secret,
      production: false
    })
    if (!token) return null
    const [presented] = await db
      .select({ id: session.id, impersonatedBy: session.impersonatedBy })
      .from(session)
      .where(eq(session.token, token))
      .limit(1)
    return presented ? { session: presented } : null
  }

  const boundary = (): Plugin => ({
    name: 'impersonation-lifecycle-browser-boundary',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', origin)
        if (url.pathname.startsWith('/operations/merchants/')) {
          response.setHeader('content-type', 'text/html')
          response.end('<h1>Operations Member detail</h1>')
          return
        }
        if (
          url.pathname === '/api/impersonation/presentation' ||
          url.pathname === '/api/impersonation/stop'
        ) {
          const current = await presentedSession(request)
          const resolution = await resolveMerchantImpersonationLifecycle({
            session: current,
            operationsOrigin: `${origin}/operations`,
            resolve: (merchantSessionId) =>
              runLifecycle((lifecycle) =>
                url.pathname.endsWith('/stop')
                  ? lifecycle.stop({ merchantSessionId })
                  : lifecycle.resolve({ merchantSessionId })
              )
          })
          if (resolution?.state === 'terminated')
            response.setHeader('set-cookie', clearImpersonationCookie(false))
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify(resolution))
          return
        }
        if (url.pathname === '/') {
          response.setHeader('content-type', 'text/html')
          response.end(
            '<!doctype html><html><body><div id="root"></div><script>window.addEventListener("error",event=>document.body.dataset.error=event.message);window.addEventListener("unhandledrejection",event=>document.body.dataset.error=String(event.reason));</script><script type="module" src="/test/impersonation-browser-harness.tsx"></script></body></html>'
          )
          return
        }
        next()
      })
    }
  })

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    db = createDb(testD1.d1)
    const vite = await createViteServer({
      configFile: false,
      root: join(import.meta.dirname, '..'),
      server: { middlewareMode: true },
      plugins: [boundary()]
    })
    const server = createHttpServer(vite.middlewares)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing address')
    origin = `http://127.0.0.1:${address.port}`
    closeServer = async () => {
      await vite.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
    browser = await chromium.launch({ headless: true })
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
    await closeServer?.()
    await testD1?.dispose()
  })

  const active = async (suffix: string, lifetimeMs = 60_000) => {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + lifetimeMs)
    const operatorId = `opr_browser_lifecycle_${suffix}`
    const operatorSessionId = `ops_browser_lifecycle_${suffix}`
    const targetMemberId = `mem_browser_lifecycle_${suffix}`
    const merchantId = `mer_browser_lifecycle_${suffix}`
    const merchantSessionId = `mss_browser_lifecycle_${suffix}`
    const token = `merchant-browser-token-${suffix}`
    await db.insert(user).values([
      {
        id: operatorId,
        email: `${operatorId}@operations.test`,
        name: `Browser Operator ${suffix}`,
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'merchant-impersonator',
        createdAt: now,
        updatedAt: now
      },
      {
        id: targetMemberId,
        email: `${targetMemberId}@merchant.test`,
        name: `Browser Target ${suffix}`,
        emailVerified: true,
        identityClass: 'merchant_member',
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(session).values([
      {
        id: operatorSessionId,
        token: `operator-browser-token-${suffix}`,
        userId: operatorId,
        expiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
        operatorIdleExpiresAt: new Date(now.getTime() + 30 * 60_000),
        operatorAbsoluteExpiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
        createdAt: now,
        updatedAt: now
      },
      {
        id: merchantSessionId,
        token,
        userId: targetMemberId,
        impersonatedBy: operatorId,
        expiresAt,
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(merchants).values({
      id: merchantId,
      publicName: `Browser Merchant ${suffix}`,
      slug: `browser-lifecycle-${suffix}`,
      timezone: 'Europe/Bucharest',
      currency: 'RON',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    const impersonationId = `imp_browser_lifecycle_${suffix}`
    await db.insert(impersonationRecords).values({
      id: impersonationId,
      operatorId,
      operatorSessionId,
      targetMemberId,
      merchantId,
      lifecycle: 'active',
      reason: 'Browser lifecycle verification',
      supportReference: 'SUP-BROWSER-LIFECYCLE',
      ticketHash: `hash-browser-lifecycle-${suffix}`,
      handoffExpiresAt: expiresAt,
      merchantSessionId,
      activeExpiresAt: expiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    return {
      impersonationId,
      operatorSessionId,
      targetMemberId,
      merchantId,
      merchantSessionId,
      token,
      cookie: `${token}.${await makeSignature(token, secret)}`
    }
  }

  const pageFor = async (fixture: Awaited<ReturnType<typeof active>>) => {
    const context = await browser.newContext()
    await context.addCookies([
      { name: 'merchant.session_token', value: fixture.cookie, url: origin }
    ])
    return { context, page: await context.newPage() }
  }

  it('shows the persistent banner and manually stops through confirmation', async () => {
    const fixture = await active('stop')
    const { context, page } = await pageFor(fixture)
    await page.goto(origin)
    await page.waitForTimeout(1_000)
    expect(await page.locator('body').getAttribute('data-error')).toBeNull()

    await browserExpect(page.getByText('Staff impersonation is active')).toBeVisible()
    await browserExpect(page.getByText('Browser Target stop')).toBeVisible()
    await browserExpect(page.getByText('Browser Merchant stop')).toBeVisible()
    await page.getByRole('button', { name: 'Stop impersonation' }).click()
    await page.getByRole('button', { name: 'Confirm stop' }).click()

    await browserExpect(page).toHaveURL(
      `${origin}/operations/merchants/${fixture.merchantId}/members/${fixture.targetMemberId}`
    )
    await browserExpect(page.getByText('Operations Member detail')).toBeVisible()
    expect(await context.cookies(origin)).toEqual([])
    const [record] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, fixture.impersonationId))
    expect(record).toMatchObject({
      lifecycle: 'stopped',
      terminationCause: 'manual-stop'
    })
    expect(
      await db.select().from(session).where(eq(session.id, fixture.operatorSessionId))
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(operationsNotificationIntents)
        .where(
          eq(operationsNotificationIntents.impersonationId, fixture.impersonationId)
        )
    ).toHaveLength(1)
    await context.close()
  }, 20_000)

  it('automatically expires, clears the cookie, and returns to Operations', async () => {
    const fixture = await active('expiry', 2_000)
    const { context, page } = await pageFor(fixture)
    await page.goto(origin)
    await browserExpect(page.getByText(/remaining/)).toBeVisible()

    await browserExpect(page).toHaveURL(
      `${origin}/operations/merchants/${fixture.merchantId}/members/${fixture.targetMemberId}`,
      { timeout: 8_000 }
    )
    expect(await context.cookies(origin)).toEqual([])
    const [record] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, fixture.impersonationId))
    expect(record).toMatchObject({
      lifecycle: 'expired',
      terminationCause: 'absolute-timeout'
    })
    await context.close()
  }, 20_000)

  it('returns a revoked browser while preserving an unrelated normal session', async () => {
    const fixture = await active('revoked')
    const { context, page } = await pageFor(fixture)
    await page.goto(origin)
    await runLifecycle((lifecycle) =>
      lifecycle.revoke({
        merchantSessionId: fixture.merchantSessionId,
        cause: 'administrative-revocation'
      })
    )
    await page.reload()
    await browserExpect(page).toHaveURL(
      `${origin}/operations/merchants/${fixture.merchantId}/members/${fixture.targetMemberId}`
    )
    expect(await context.cookies(origin)).toEqual([])

    const normal = await active('normal')
    await db
      .update(session)
      .set({ impersonatedBy: null })
      .where(eq(session.id, normal.merchantSessionId))
    const normalBrowser = await pageFor(normal)
    await normalBrowser.page.goto(origin)
    await browserExpect(
      normalBrowser.page.getByText('Normal Merchant Session')
    ).toBeVisible()
    expect(await normalBrowser.context.cookies(origin)).toHaveLength(1)
    await normalBrowser.context.close()
    await context.close()
  }, 20_000)
})
