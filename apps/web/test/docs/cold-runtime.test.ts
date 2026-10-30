// @vitest-environment node
/* oxlint-disable effect/noNodeBuiltinImport -- native workerd integration test owns local bundle paths. */
import { resolve as resolvePath } from 'node:path'
import { globSync } from 'node:fs'
import { Miniflare, convertV4MiniflareOptions, Response, type Request } from 'miniflare'
import { expect, it } from 'vite-plus/test'
import { workerCompatibility } from '../../../../infra/bindings'

const locales = ['en', 'nb']

function runtime(gate?: (request: Request) => Promise<Response> | Response) {
  const root = resolvePath(import.meta.dirname, '../../dist-docs-runtime/server')
  const serviceBindings: Record<string, NonNullable<typeof gate>> = {}
  if (gate !== undefined) {
    serviceBindings.DOCS_RENDER_GATE = gate
  }
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: ['fetch.js', ...globSync('assets/**/*.js', { cwd: root })].map(
        (path) => ({
          type: 'ESModule',
          path: resolvePath(root, path)
        })
      ),
      modulesRoot: root,
      compatibilityDate: workerCompatibility.date,
      compatibilityFlags: [...workerCompatibility.flags],
      cf: false,
      serviceBindings
    })
  )
}

async function article(worker: Miniflare, locale: string) {
  const response = await worker.dispatchFetch(
    `https://docs.test${locale === 'nb' ? '/no' : ''}/docs/getting-started/quickstart`,
    { signal: AbortSignal.timeout(15_000) }
  )
  return { status: response.status, body: await response.text() }
}

function expectArticle(result: Awaited<ReturnType<typeof article>>, locale: string) {
  expect(result.status).toBe(200)
  expect(result.body.match(/<html\b[^>]*>/)?.[0]).toContain(`lang="${locale}"`)
  expect(result.body).toContain('Quickstart')
  expect(result.body).toMatch(
    /<h2\b[^>]*id="install-and-run"[^>]*>Install and run<\/h2>/
  )
  expect(result.body).toContain(`${locale === 'nb' ? '/no' : ''}/docs/`)
  expect(result.body).toContain(locale === 'nb' ? 'Kom i gang' : 'Getting started')
  expect(result.body).not.toContain(locale === 'nb' ? 'Getting started' : 'Kom i gang')
  expect(result.body).not.toContain('Controlled rendering failure')
}

it('serves overlapping cold docs and warm locale-specific follow-ups in workerd', async () => {
  const worker = runtime()
  try {
    const results = await Promise.all(locales.map((locale) => article(worker, locale)))
    results.forEach((result, index) => expectArticle(result, locales[index]!))
    for (const locale of locales.toReversed()) {
      expectArticle(await article(worker, locale), locale)
    }
  } finally {
    await worker.dispose()
  }
}, 30_000)

it('keeps overlapping pending document renders owned by each request', async () => {
  const gateControl = { release: () => {} }
  // Miniflare's service-binding callback waits for the test to release both requests.
  const pendingGate = new Promise<void>((resolve) => {
    gateControl.release = resolve
  })
  const arrived = new Set<string>()
  const worker = runtime(async (request) => {
    arrived.add(new URL(request.headers.get('x-docs-request')!).pathname.split('/')[1]!)
    await pendingGate
    return new Response('')
  })
  const pending = locales.map((locale) => article(worker, locale))
  try {
    await expect.poll(() => arrived.size, { timeout: 5000 }).toBe(2)
    gateControl.release()
    const results = await Promise.all(pending)
    results.forEach((result, index) => expectArticle(result, locales[index]!))
  } finally {
    gateControl.release()
    await Promise.allSettled(pending)
    await worker.dispose()
  }
}, 30_000)

it('recovers after the first document render rejects in the same isolate', async () => {
  let attempts = 0
  let failing = true
  const worker = runtime(() => {
    attempts++
    return new Response('', { status: failing ? 503 : 200 })
  })
  try {
    const failed = await article(worker, 'en')
    expect(failed.status).toBe(500)
    expect(attempts).toBeGreaterThan(0)
    const failedAttempts = attempts
    failing = false
    expectArticle(await article(worker, 'nb'), 'nb')
    expect(attempts).toBeGreaterThan(failedAttempts)
    const completedAttempts = attempts
    expectArticle(await article(worker, 'en'), 'en')
    // Native metadata is compiled at build time. Each request still owns its
    // render, rather than reusing another request's pending or failed response.
    expect(attempts).toBeGreaterThan(completedAttempts)
  } finally {
    await worker.dispose()
  }
}, 30_000)
