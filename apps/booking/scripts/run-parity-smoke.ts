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

const capture = async (
  context: BrowserContext,
  page: Page,
  scenario: ScenarioManifest,
  tracePath: string
): Promise<DriverEvidence> => {
  const consoleEntries: { type: string; text: string }[] = []
  const requests: { url: string; method: string; status?: number }[] = []
  const responseStates: Promise<unknown>[] = []
  page.on('console', (message) =>
    consoleEntries.push({ type: message.type(), text: message.text() })
  )
  page.on('response', (response) => {
    requests.push({
      url: canonicalUrl(response.url()),
      method: response.request().method(),
      status: response.status()
    })
    if (response.headers()['content-type']?.includes('application/json')) {
      responseStates.push(
        response
          .json()
          .then((body) => ({
            url: canonicalUrl(response.url()),
            status: response.status(),
            body
          }))
          .catch(() => ({
            url: canonicalUrl(response.url()),
            status: response.status()
          }))
      )
    }
  })
  await page.goto(`${origin}${scenario.route}`)
  if (scenario.journey === 'pay-in-person') {
    await page.getByRole('button', { name: /Any professional/ }).click()
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
    await page.getByText('Pay In Person').waitFor()
    await page.evaluate(async () => {
      const response = await fetch(`${window.location.pathname}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
      if (!response.ok) throw new Error(`Confirmation failed: ${response.status}`)
      await response.json()
    })
  } else if (scenario.journey === 'selection-loading') {
    await page.getByRole('heading', { name: 'Preparing your booking' }).waitFor()
  } else if (scenario.journey === 'selection-error') {
    await page.getByRole('heading', { name: 'Selection unavailable' }).waitFor()
  }
  const body = page.locator('body')
  const visibleText = (await body.innerText()).trim()
  const semanticAssertions = [
    {
      assertion: scenario.assertions[0]!,
      passed:
        scenario.journey === 'deliberate-blank'
          ? (await page.locator('main').count()) === 0
          : visibleText.length > 0
    }
  ]
  const screenshot = await page.screenshot({ animations: 'disabled', fullPage: true })
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
    canonicalState: await Promise.all(responseStates),
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
const browser = await chromium.launch()
try {
  for (const scenario of smokeScenarios) {
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
            const response =
              selected.journey === 'selection-loading' &&
              parsed.pathname.endsWith('/selection')
                ? await new Promise<Response>((resolve) => {
                    void fixtureRequest(fixtureHttpRequest)
                    page.once('close', () =>
                      resolve(new Response(null, { status: 499 }))
                    )
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
            resolve(runDirectory, 'trace.zip')
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
