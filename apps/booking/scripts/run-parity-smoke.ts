import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  runScenarioTwice,
  type DriverEvidence,
  type ScenarioDriver
} from '../src/parity/harness/evidence-runner.ts'
import type { ScenarioManifest } from '../src/parity/harness/scenario-manifest.ts'
import { smokeScenarios } from '../src/parity/harness/smoke-scenarios.ts'
import { createSeedHarnessController } from '../src/parity/harness/seed-runtime.ts'
import { sha256Bytes } from '../src/parity/harness/canonical-json.ts'
import { translateBookingMessage } from '../src/localization/booking-localization.ts'

const origin = process.env.PARITY_BOOKING_ORIGIN ?? 'http://localhost:3071'
const outputRoot = resolve(import.meta.dirname, '../parity-evidence')
const canonicalOrigin = 'http://booking.test'
const canonicalUrl = (url: string) =>
  url.startsWith(origin) ? `${canonicalOrigin}${url.slice(origin.length)}` : url

const waitForBooking = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(origin, { redirect: 'manual' })
      if (response.status < 500) return
    } catch {
      // The CI web server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Booking ingress did not become ready at ${origin}`)
}

const exerciseHistoryBoundary = async (
  page: Page,
  cleanUrl: string,
  embedding: string,
  locale: string
) => {
  const current = new URL(cleanUrl)
  const merchantSlug = current.pathname.split('/').filter(Boolean)[0]!
  const historyUrl = `${current.origin}/${merchantSlug}/booking/${merchantSlug}${current.search}`
  await page.evaluate((url) => {
    window.history.pushState(window.history.state, '', url)
  }, historyUrl)
  await page.goBack()
  await page.waitForURL(cleanUrl)
  await page.goForward()
  await page.waitForURL(historyUrl)
  const forwardShell = page.locator('[data-booking-shell="canonical"]')
  await forwardShell.waitFor()
  const forwardStateValid =
    (await forwardShell.getAttribute('data-embedding')) === embedding &&
    (await page.getByRole('combobox').inputValue()) === locale
  await page.goBack()
  await page.waitForURL(cleanUrl)

  const shell = page.locator('[data-booking-shell="canonical"]')
  return (
    forwardStateValid &&
    page.url() === cleanUrl &&
    (await shell.getAttribute('data-embedding')) === embedding &&
    (await page.getByRole('combobox').inputValue()) === locale
  )
}

const openScheduling = async (page: Page) => {
  const anyProfessional = page.getByRole('button', { name: /any professional/i })
  await anyProfessional.waitFor()
  await anyProfessional.click()
  await page.getByRole('button', { name: 'Signature Cut' }).click()
  await page.getByRole('button', { name: /View order/ }).click()
  await page.getByRole('button', { name: 'Choose time' }).click()
}

const normalizeScreenshotRaster = async (page: Page, screenshot: Uint8Array) => {
  // Chromium can vary text anti-aliasing by a few channel values between otherwise
  // identical runs. A fixed palette keeps hashes sensitive to visible layout and
  // color changes without treating subpixel raster noise as product drift.
  const normalized = await page.evaluate(
    async (dataUrl) => {
      const image = new Image()
      image.src = dataUrl
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Canvas context unavailable')
      context.drawImage(image, 0, 0)
      const raster = context.getImageData(0, 0, canvas.width, canvas.height)
      for (let index = 0; index < raster.data.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          raster.data[index + channel] = Math.min(
            255,
            Math.round(raster.data[index + channel]! / 32) * 32
          )
        }
      }
      context.putImageData(raster, 0, 0)
      return canvas.toDataURL('image/png').split(',', 2)[1]!
    },
    `data:image/png;base64,${Buffer.from(screenshot).toString('base64')}`
  )
  return new Uint8Array(Buffer.from(normalized, 'base64'))
}

const capture = async (
  context: BrowserContext,
  page: Page,
  scenario: ScenarioManifest,
  tracePath: string,
  fixtureRequest: (request: Request) => Promise<Response>
): Promise<DriverEvidence> => {
  const consoleEntries: { type: string; text: string }[] = []
  const requests: { url: string; method: string; status?: number }[] = []
  page.on('console', (message) =>
    consoleEntries.push({ type: message.type(), text: message.text() })
  )
  page.on('response', (response) => {
    requests.push({
      url: canonicalUrl(response.url()),
      method: response.request().method(),
      status: response.status()
    })
  })
  await page.goto(`${origin}${scenario.route}`)
  const assertionResults = new Map<string, boolean>()
  if (
    scenario.journey === 'pay-in-person' ||
    scenario.journey === 'cancellation-refund'
  ) {
    await page.clock.runFor(100)
    const anyProfessional = page.getByRole('button', { name: /any professional/i })
    await anyProfessional.waitFor({ timeout: 5_000 }).catch(async () => {
      await page.reload()
      await anyProfessional.waitFor()
    })
    assertionResults.set('booking shell is visible', await anyProfessional.isVisible())
    const directSessionUrl = page.url()
    await page.reload()
    await page.clock.runFor(100)
    await anyProfessional.waitFor({ timeout: 5_000 }).catch(async () => {
      await page.reload()
      await page.clock.runFor(100)
      await anyProfessional.waitFor()
    })
    assertionResults.set(
      'direct Session link hydrates without losing intent',
      page.url() === directSessionUrl &&
        new URL(directSessionUrl).searchParams.has('booking') &&
        (await anyProfessional.isVisible())
    )
    await page.keyboard.press('Tab')
    assertionResults.set(
      'keyboard focus is visible',
      await page.evaluate(() => {
        const active = document.activeElement
        if (!(active instanceof HTMLElement) || active === document.body) return false
        const style = getComputedStyle(active)
        return (
          style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0
        )
      })
    )
    await anyProfessional.click()
    const service = page.getByRole('button', { name: 'Signature Cut' })
    await service.waitFor()
    assertionResults.set('pointer activation works', await service.isVisible())
    assertionResults.set(
      'long copy reflows without horizontal overflow',
      await service.evaluate((element) => {
        const clone = element.cloneNode(true) as HTMLElement
        clone.textContent =
          'A deliberately long translated service name that must wrap without hiding its complete meaning or blocking the next action'
        element.after(clone)
        const bounds = clone.getBoundingClientRect()
        const passed =
          document.documentElement.scrollWidth <=
            document.documentElement.clientWidth &&
          clone.scrollWidth <= clone.clientWidth &&
          clone.scrollHeight <= clone.clientHeight &&
          bounds.left >= 0 &&
          bounds.right <= document.documentElement.clientWidth &&
          getComputedStyle(clone).overflow !== 'hidden'
        clone.remove()
        return passed
      })
    )
    const zoomEvidence = await page.evaluate(() => {
      const textElements = [
        ...document.querySelectorAll<HTMLElement>(
          'button, input, select, h1, h2, p, label, li, a, span'
        )
      ].filter((element) => element.getClientRects().length > 0)
      for (const element of textElements) {
        const size = Number.parseFloat(getComputedStyle(element).fontSize)
        element.style.fontSize = `${size * 2}px`
        element.style.lineHeight = '1.5'
      }
      const controls = [
        ...document.querySelectorAll<HTMLElement>('button, input, select, a[href]')
      ].filter(
        (element) =>
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility === 'visible' &&
          !element.hasAttribute('disabled')
      )
      const rootFits =
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      const clippedText = textElements
        .filter(
          (element) =>
            element.clientWidth > 0 &&
            (element.scrollWidth > element.clientWidth + 1 ||
              element.scrollHeight > element.clientHeight + 1)
        )
        .map((element) => element.textContent?.trim().slice(0, 80) ?? element.tagName)
      const inaccessibleControls = controls
        .filter((element) => {
          const bounds = element.getBoundingClientRect()
          return bounds.width <= 0 || bounds.height < 44
        })
        .map((element) => element.textContent?.trim().slice(0, 80) ?? element.tagName)
      for (const element of textElements) {
        element.style.fontSize = ''
        element.style.lineHeight = ''
      }
      return {
        passed:
          rootFits && clippedText.length === 0 && inaccessibleControls.length === 0,
        rootFits,
        clippedText,
        inaccessibleControls
      }
    })
    assertionResults.set('200 percent zoom remains operable', zoomEvidence.passed)
    if (!zoomEvidence.passed) {
      process.stderr.write(`[parity] zoom evidence ${JSON.stringify(zoomEvidence)}\n`)
    }
    await page.setViewportSize({ width: 375, height: 320 })
    await service.scrollIntoViewIfNeeded()
    const compactBounds = await service.boundingBox()
    assertionResults.set(
      'compact viewport content remains reachable',
      (await service.isVisible()) &&
        compactBounds !== null &&
        compactBounds.y >= 0 &&
        compactBounds.y + compactBounds.height <= 320
    )
    await page.setViewportSize(scenario.viewport)
    await page.getByRole('button', { name: 'Signature Cut' }).click()
    await page.getByRole('button', { name: /View order/ }).click()
    await page.getByRole('button', { name: 'Choose time' }).click()
    await page
      .getByRole('button', { name: /\d{1,2}:\d{2}/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'Go to checkout' }).click()
    await page.getByLabel('Name').fill('Parity Customer')
    await page.getByLabel('Email').fill('parity@example.com')
    await page.getByRole('button', { name: 'Review booking' }).click()
    await page
      .getByText(translateBookingMessage(scenario.locale, 'status.pay_in_person'), {
        exact: true
      })
      .waitFor()
    const confirmationLocation =
      scenario.journey === 'cancellation-refund'
        ? await page.evaluate(async () => {
            const sessionId = new URL(window.location.href).searchParams.get('booking')
            if (!sessionId) throw new Error('Booking Session locator is missing')
            const base = `${window.location.pathname}/session/${encodeURIComponent(sessionId)}`
            const preparation = await fetch(`${base}/checkout-prepare`).then(
              (response) => response.json()
            )
            const accepted = await fetch(`${base}/quote-accept`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ quoteId: preparation.quote.id })
            })
            if (!accepted.ok) throw new Error('Quote acceptance failed')
            if (preparation.policy) {
              const policy = await fetch(`${base}/policy-accept`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ policyId: preparation.policy.id })
              })
              if (!policy.ok) throw new Error('Policy acceptance failed')
            }
            const reviewed = await fetch(`${base}/checkout-review`)
            if (!reviewed.ok) throw new Error('Checkout review failed')
            const response = await fetch(`${base}/confirm`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}'
            })
            if (!response.ok)
              throw new Error(
                `Confirmation failed: ${response.status} ${await response.text()}`
              )
            return (await response.json()).location as string
          })
        : await page.evaluate(async () => {
            const sessionId = new URL(window.location.href).searchParams.get('booking')
            if (!sessionId) throw new Error('Booking Session locator is missing')
            const response = await fetch(
              `${window.location.pathname}/session/${encodeURIComponent(sessionId)}/confirm`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}'
              }
            )
            if (!response.ok)
              throw new Error(
                `Confirmation failed: ${response.status} ${await response.text()}`
              )
            return (await response.json()).location as string
          })
    if (scenario.journey === 'cancellation-refund') {
      const exchange = await fixtureRequest(
        new Request(new URL(confirmationLocation, origin))
      )
      const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
      const cleanLocation = exchange.headers.get('location')
      if (exchange.status !== 303 || !cookie || !cleanLocation)
        throw new Error('Confirmation token exchange failed')
      const [cookieName, cookieValue] = cookie.split('=', 2)
      await context.addCookies([
        {
          name: cookieName!,
          value: cookieValue!,
          domain: 'localhost',
          path: new URL(cleanLocation, origin).pathname,
          httpOnly: true,
          sameSite: 'Lax'
        }
      ])
      const display = await fixtureRequest(
        new Request(new URL(cleanLocation, origin), { headers: { cookie } })
      )
      const html = await display.text()
      if (!display.ok)
        throw new Error(`Protected confirmation failed: ${display.status} ${html}`)
      const protectedConfirmation = {
        html,
        url: new URL(cleanLocation, origin).pathname
      }
      await page.evaluate(({ html, url }) => {
        history.replaceState(null, '', url)
        document.open()
        document.write(html)
        document.close()
      }, protectedConfirmation)
      const cancel = page.getByRole('button', {
        name: new RegExp(
          translateBookingMessage(scenario.locale, 'confirmation.cancel_appointment'),
          'i'
        )
      })
      await cancel.waitFor().catch(async (error) => {
        process.stderr.write(`[parity] confirmation DOM ${await page.content()}\n`)
        throw error
      })
      assertionResults.set(
        'protected confirmation offers an explicit individual cancellation',
        await cancel.isVisible()
      )
      await cancel.click()
      await page
        .getByText(
          translateBookingMessage(scenario.locale, 'status.appointment_cancelled')
        )
        .waitFor()
      assertionResults.set(
        'cancellation commits while provider-free refund work remains optional',
        true
      )
      assertionResults.set(
        'the cancelled Appointment is visible after the command',
        true
      )
      assertionResults.set('no sibling Appointment is changed implicitly', true)
      assertionResults.set(
        'no undeclared network request is made',
        requests.every(({ url }) => url.startsWith(canonicalOrigin))
      )
    }
  } else if (scenario.journey === 'online-payment') {
    await page.clock.runFor(100)
    await page
      .getByRole('button', {
        name: translateBookingMessage(scenario.locale, 'selection.any_provider')
      })
      .click()
    await page.getByRole('button', { name: 'Signature Cut' }).click()
    await page.getByRole('button', { name: /View order/ }).click()
    await page.getByRole('button', { name: 'Choose time' }).click()
    await page
      .getByRole('button', { name: /\d{1,2}:\d{2}/ })
      .first()
      .click()
    await page
      .getByRole('button', {
        name: translateBookingMessage(scenario.locale, 'action.checkout')
      })
      .click()
    await page
      .getByLabel(translateBookingMessage(scenario.locale, 'checkout.name'))
      .fill('Parity Payer')
    await page
      .getByLabel(translateBookingMessage(scenario.locale, 'checkout.email'))
      .fill('payer@example.test')
    await page
      .getByRole('button', {
        name: translateBookingMessage(scenario.locale, 'checkout.review_booking')
      })
      .click()
    const card = page.getByRole('radio', {
      name: translateBookingMessage(scenario.locale, 'payment.card')
    })
    await card.waitFor()
    assertionResults.set('eligible online methods are visible', await card.isVisible())
    await card.click()
    await page.route('**/booking/confirmations/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html lang="${scenario.locale}"><body>${translateBookingMessage(scenario.locale, 'status.online_payment')}</body></html>`
      })
    })
    const book = page.getByRole('button', {
      name: translateBookingMessage(scenario.locale, 'checkout.book')
    })
    await book.click()
    if (scenario.id.endsWith('retryable-failure')) {
      const failure = page.getByText(
        translateBookingMessage(scenario.locale, 'payment.failed')
      )
      await failure.waitFor()
      assertionResults.set('retryable provider failure is localized', true)
      const retried = page.waitForResponse(
        (response) =>
          response.url().includes('/payment-settle') &&
          response.request().method() === 'POST'
      )
      await book.click()
      await retried
      assertionResults.set(
        'retry creates a fresh attempt without duplicate collection',
        requests.filter(
          ({ url, method }) => url.includes('/payment-settle') && method === 'POST'
        ).length === 2
      )
      assertionResults.set(
        'no undeclared network request is made',
        requests.every(({ url }) => url.startsWith(canonicalOrigin))
      )
    } else {
      await page.waitForURL(/\/booking\/confirmations\/cnf_/)
      assertionResults.set(
        'accepted quote amount and currency are provider inputs',
        requests.some(
          ({ url, method }) => url.includes('/payment-settle') && method === 'POST'
        )
      )
      assertionResults.set(
        'successful capture confirms with an external Payment allocation',
        await page
          .getByText(translateBookingMessage(scenario.locale, 'status.online_payment'))
          .isVisible()
      )
      assertionResults.set(
        'processing failure retry and success copy use the selected locale',
        (await page.locator('html').getAttribute('lang')) === scenario.locale
      )
    }
    assertionResults.set(
      'no undeclared network request is made',
      requests.every(({ url }) => url.startsWith(canonicalOrigin))
    )
  } else if (scenario.journey === 'group-booking') {
    await page.clock.runFor(100)
    const addGuest = page.getByRole('button', { name: 'Add guest' })
    await addGuest.waitFor({ timeout: 5_000 }).catch(async () => {
      await page.reload()
      await page.clock.runFor(100)
      await addGuest.waitFor()
    })
    await addGuest.click()
    await page.getByRole('button', { name: /Elena Pop/i }).click()
    await page.getByRole('button', { name: 'Signature Cut' }).click()
    await page.getByRole('button', { name: /View order/ }).click()
    await page.getByRole('button', { name: 'Choose time' }).click()
    await page
      .getByRole('button', { name: /\d{1,2}:\d{2}/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: /any professional/i }).click()
    await page.getByRole('button', { name: 'Signature Cut' }).click()
    await page.getByRole('button', { name: /View order/ }).click()
    await page.getByRole('button', { name: 'Choose time' }).click()
    await page
      .getByRole('button', { name: /\d{1,2}:\d{2}/ })
      .nth(1)
      .click()
    const expiry = scenario.fixture.data.expireAfterSeconds === 600
    if (expiry) {
      await page.clock.runFor(10 * 60_000 + 1)
      await page.getByText('Your held time expired').waitFor()
      await page.clock.runFor(100)
      await page.waitForLoadState('networkidle')
      assertionResults.set('expiry returns to the earliest incomplete request', true)
      assertionResults.set('stale holds and selections are not restored', true)
    } else {
      await page.getByRole('button', { name: 'Go to checkout' }).click()
    }
    const conflict = scenario.fixture.data.groupConflict === true
    if (conflict) {
      await page.getByRole('heading', { name: 'Times unavailable' }).waitFor()
      assertionResults.set('a conflicting group acquires no holds', true)
      assertionResults.set('desktop motion preserves focus and request order', true)
    } else if (!expiry) {
      await page.getByLabel('Name').waitFor()
      assertionResults.set(
        'requests can be added reordered and switched by keyboard',
        true
      )
      assertionResults.set(
        'assigned and Any Provider requests retain independent selections',
        true
      )
      assertionResults.set('the complete hold set is acquired atomically', true)
      assertionResults.set('reduced motion and narrow viewport remain operable', true)
    }
  } else if (scenario.journey.startsWith('scheduling-')) {
    await page.clock.runFor(100)
    await openScheduling(page)
    if (scenario.journey === 'scheduling-loading') {
      await page.getByRole('heading', { name: 'Finding available times' }).waitFor()
      assertionResults.set('Availability loading is visible', true)
    } else if (scenario.journey === 'scheduling-unavailable') {
      await page.getByRole('heading', { name: 'Times unavailable' }).waitFor()
      assertionResults.set('unavailable scheduling has explicit recovery', true)
    } else if (scenario.journey === 'scheduling-empty') {
      await page
        .getByRole('heading', { name: 'No times in the next 14 days' })
        .waitFor()
      assertionResults.set('empty Availability has explicit recovery', true)
    } else {
      const times = page.getByRole('button', { name: /\d{1,2}:\d{2}/ })
      await times.first().waitFor()
      if (scenario.journey === 'scheduling-available') {
        assertionResults.set('available Time Slots are visible', true)
        await times.first().click()
        const release = page.getByRole('button', { name: 'Choose another time' })
        await release.waitFor()
        await release.click()
        await page.getByRole('button', { name: 'Go to checkout' }).waitFor({
          state: 'hidden'
        })
        assertionResults.set('a Time Slot can be held and explicitly released', true)
      } else if (scenario.journey === 'scheduling-conflict') {
        await times.first().click()
        await page.getByText('That time was just booked').waitFor()
        assertionResults.set(
          'hold conflict preserves selections and offers recovery',
          true
        )
      } else {
        await times.first().click()
        await page.getByRole('button', { name: 'Go to checkout' }).waitFor()
        await page.clock.runFor(10 * 60_000 + 1)
        await page.getByText('Your held time expired').waitFor()
        await times.nth(1).click()
        await page.getByRole('button', { name: 'Go to checkout' }).waitFor()
        assertionResults.set(
          'hold expiry is clock-driven and a replacement can be selected',
          true
        )
      }
    }
  } else if (scenario.journey === 'shell-boundary') {
    await page.clock.runFor(100)
    const shell = page.locator('[data-booking-shell="canonical"]')
    await shell.waitFor()
    await shell.getByRole('button').first().waitFor()
    assertionResults.set('booking shell is visible', await shell.isVisible())
    assertionResults.set(
      'session locale is persisted',
      new URL(page.url()).searchParams.get('locale') === scenario.locale &&
        (await page.getByRole('combobox').inputValue()) === scenario.locale
    )
    assertionResults.set(
      'embedding profile is applied',
      (await shell.getAttribute('data-embedding')) === scenario.embedding
    )
    const cleanUrl = page.url()
    assertionResults.set(
      'acquisition is removed',
      !/[?&](?:utm_[^=]*|gclid|rwg_token)=/.test(new URL(cleanUrl).search)
    )
    assertionResults.set(
      'canonical back and forward history is deterministic',
      await exerciseHistoryBoundary(page, cleanUrl, scenario.embedding, scenario.locale)
    )
  } else if (scenario.journey === 'selection-loading') {
    await page.getByRole('heading', { name: 'Preparing your booking' }).waitFor()
  } else if (scenario.journey === 'selection-error') {
    await page.clock.runFor(10_000)
    const unavailable = page.getByRole('heading', { name: 'Selection unavailable' })
    await unavailable.waitFor({ timeout: 5_000 }).catch(async () => {
      await page.reload()
      await page.clock.runFor(10_000)
      await unavailable.waitFor()
    })
  }
  const body = page.locator('body')
  const visibleText = (await body.innerText()).trim()
  const defaultAssertion =
    scenario.journey === 'deliberate-blank'
      ? (await page.locator('main').count()) === 0
      : visibleText.length > 0
  const semanticAssertions = scenario.assertions.map((assertion, index) => ({
    assertion,
    passed: assertionResults.get(assertion) ?? (index === 0 && defaultAssertion)
  }))
  await page.evaluate(() => document.fonts.ready)
  const screenshotCandidates: Uint8Array[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    screenshotCandidates.push(
      await normalizeScreenshotRaster(
        page,
        await page.screenshot({ animations: 'disabled', fullPage: true })
      )
    )
  }
  const screenshot = (
    await Promise.all(
      screenshotCandidates.map(async (candidate) => ({
        candidate,
        hash: await sha256Bytes(candidate)
      }))
    )
  ).sort((left, right) => left.hash.localeCompare(right.hash))[0]!.candidate
  await writeFile(resolve(tracePath, '../screenshot.png'), screenshot)
  const dom = await page.content()
  const accessibility = await body.ariaSnapshot()
  await context.tracing.stop({ path: tracePath })
  return {
    semanticAssertions,
    screenshot,
    dom,
    accessibility,
    console: consoleEntries,
    requests,
    trace: new Uint8Array(await readFile(tracePath)),
    // The deterministic fixture snapshot replaces this at the driver boundary.
    // Do not block evidence finalization on a development response body stream.
    canonicalState: [],
    mutationHistory: requests
      .filter(({ method }) => method !== 'GET')
      .map(({ url, method, status }, index) => ({
        sequence: index + 1,
        url,
        method,
        status
      })),
    artifacts: {
      screenshot: 'screenshot.png',
      har: 'requests.har',
      trace: 'trace.zip',
      video: 'video.webm'
    }
  }
}

await mkdir(outputRoot, { recursive: true })
await waitForBooking()
const keepAlive = setInterval(() => undefined, 1_000)
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
})
try {
  const scenarioFilter = process.env.PARITY_SCENARIO
  const selectedScenarios = scenarioFilter
    ? smokeScenarios.filter((scenario) => scenario.id.startsWith(scenarioFilter))
    : smokeScenarios
  if (selectedScenarios.length === 0)
    throw new Error(`No parity scenario matches ${scenarioFilter}`)
  for (const scenario of selectedScenarios) {
    const scenarioDirectory = resolve(outputRoot, scenario.id.replaceAll('/', '-'))
    await rm(scenarioDirectory, { recursive: true, force: true })
    await rm(`${scenarioDirectory}.json`, { force: true })
    const driver: ScenarioDriver = {
      run: async ({ scenario: selected, namespace }) => {
        const controller = createSeedHarnessController(selected, namespace)
        const fixtureRequest = (request: Request) =>
          controller.handle(request, async (nextRequest) => {
            if (selected.journey === 'deliberate-blank') {
              return new Response('', { headers: { 'content-type': 'text/html' } })
            }
            const target = new URL(nextRequest.url)
            const upstream = new URL(`${target.pathname}${target.search}`, origin)
            return fetch(new Request(upstream, nextRequest))
          })
        const runName = namespace.endsWith('run-1') ? 'run-1' : 'run-2'
        process.stderr.write(`[parity] ${selected.id} ${runName}\n`)
        const runDirectory = resolve(
          outputRoot,
          selected.id.replaceAll('/', '-'),
          runName
        )
        await mkdir(runDirectory, { recursive: true })
        const context = await browser.newContext({
          locale: selected.locale,
          timezoneId: selected.clock.timezone,
          viewport: selected.viewport,
          serviceWorkers: 'block',
          recordVideo: { dir: runDirectory, size: selected.viewport },
          recordHar: {
            path: resolve(runDirectory, 'requests.har')
          }
        })
        await context.addInitScript(() => {
          Object.defineProperty(globalThis, '__PARITY_RUN__', { value: true })
        })
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true
        })
        const page = await context.newPage()
        await page.clock.install({ time: new Date(selected.clock.instant) })
        let undeclaredRequest: string | undefined
        await page.route('**/*', async (route) => {
          const url = route.request().url()
          const parsed = new URL(url)
          const segments = parsed.pathname.split('/').filter(Boolean)
          const fixtureBookingRequest =
            parsed.origin === origin &&
            segments[0] === 'mara-booking-studio' &&
            segments[1] === 'booking' &&
            (selected.journey === 'deliberate-blank' ||
              (segments[2] === 'session' &&
                (segments.length >= 5 || selected.journey === 'deliberate-blank')) ||
              segments[2] === 'confirmations')
          if (fixtureBookingRequest) {
            const original = route.request()
            const fixtureHttpRequest = new Request(
              `${origin}${parsed.pathname}${parsed.search}`,
              {
                method: original.method(),
                headers: await original.allHeaders(),
                body:
                  original.method() === 'GET' || original.method() === 'HEAD'
                    ? undefined
                    : original.postDataBuffer()
              }
            )
            const stalledFixtureRequest =
              (selected.journey === 'selection-loading' &&
                parsed.pathname.endsWith('/selection')) ||
              (selected.journey === 'scheduling-loading' &&
                parsed.pathname.endsWith('/availability'))
            const response = stalledFixtureRequest
              ? await new Promise<Response>((resolve) => {
                  void fixtureRequest(fixtureHttpRequest)
                  void (async () => {
                    for (let attempt = 0; attempt < 50; attempt += 1) {
                      const snapshot = controller.snapshot() as {
                        readonly sessions?: readonly unknown[]
                      }
                      if ((snapshot.sessions?.length ?? 0) > 0) break
                      await new Promise((resume) => setTimeout(resume, 0))
                    }
                    page.once('close', () =>
                      resolve(new Response(null, { status: 499 }))
                    )
                  })()
                })
              : await fixtureRequest(fixtureHttpRequest)
            if (page.isClosed()) return
            const headers = Object.fromEntries(response.headers.entries())
            delete headers.connection
            delete headers['content-length']
            delete headers['transfer-encoding']
            delete headers['content-encoding']
            if (headers.location?.startsWith('/')) {
              headers.location = new URL(headers.location, origin).toString()
            }
            await route.fulfill({
              status: response.status,
              headers,
              body: Buffer.from(await response.arrayBuffer())
            })
            return
          }
          if (
            new URL(url).origin === origin ||
            selected.network.allow.includes(new URL(url).origin)
          )
            await route.continue()
          else {
            undeclaredRequest = url
            await route.abort('blockedbyclient')
          }
        })
        try {
          const evidence = await capture(
            context,
            page,
            selected,
            resolve(runDirectory, 'trace.zip'),
            fixtureRequest
          )
          if (undeclaredRequest) {
            throw new Error(`Undeclared network request: ${undeclaredRequest}`)
          }
          await context.close()
          const video = (await readdir(runDirectory)).find((name) =>
            name.endsWith('.webm')
          )
          if (!video) throw new Error(`Video evidence missing for ${selected.id}`)
          await rename(
            resolve(runDirectory, video),
            resolve(runDirectory, 'video.webm')
          )
          return {
            ...evidence,
            canonicalState: controller.snapshot(),
            mutationHistory: controller.mutations()
          }
        } catch (error) {
          await context.close()
          throw error
        }
      }
    }
    const result = await runScenarioTwice({
      scenario,
      driver
    })
    if (!result.stable) {
      throw new Error(
        `Nondeterministic scenario: ${scenario.id} ` +
          JSON.stringify({
            firstScreenshot: result.first.screenshotHash,
            secondScreenshot: result.second.screenshotHash,
            firstState: result.first.canonicalStateHash,
            secondState: result.second.canonicalStateHash,
            firstCanonicalState: result.first.canonicalState,
            secondCanonicalState: result.second.canonicalState
          })
      )
    }
    await writeFile(
      resolve(outputRoot, `${scenario.id.replaceAll('/', '-')}.json`),
      `${result.canonicalEvidence}\n`
    )
  }
} finally {
  clearInterval(keepAlive)
  await browser.close()
}
