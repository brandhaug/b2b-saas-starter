// @vitest-environment node
/* oxlint-disable effect/noNodeBuiltinImport -- native workerd integration test owns local bundle paths. */
import { resolve } from 'node:path'
import { globSync } from 'node:fs'
import { Miniflare, convertV4MiniflareOptions, Response, type Request } from 'miniflare'
import { expect, it } from 'vite-plus/test'
import { workerCompatibility } from '../../../../infra/bindings'

const locales = ['en', 'nb']

function runtime(gate?: (request: Request) => Promise<Response> | Response) {
  const root = resolve(import.meta.dirname, '../../dist-docs-runtime/server')
  const serviceBindings: Record<string, NonNullable<typeof gate>> = {}
  if (gate !== undefined) {
    serviceBindings.DOCS_METADATA_GATE = gate
  }
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: ['worker.js', ...globSync('assets/**/*.js', { cwd: root })].map(
        (path) => ({
          type: 'ESModule',
          path: resolve(root, path)
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
    `https://docs.test/${locale}/docs/getting-started/quickstart`,
    { signal: AbortSignal.timeout(15_000) }
  )
  return { status: response.status, body: await response.text() }
}

function expectArticle(result: Awaited<ReturnType<typeof article>>, locale: string) {
  expect(result.status).toBe(200)
  expect(result.body).toContain(`<html lang="${locale}"`)
  expect(result.body).toContain('Quickstart')
  expect(result.body).toMatch(
    /<h2\b[^>]*id="install-and-run"[^>]*>Install and run<\/h2>/
  )
  expect(result.body).toContain(`/${locale}/docs/`)
  expect(result.body).toContain(locale === 'nb' ? 'Kom i gang' : 'Getting started')
  expect(result.body).not.toContain(locale === 'nb' ? 'Getting started' : 'Kom i gang')
  expect(result.body).not.toContain('Controlled metadata loading failure')
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

it('keeps overlapping pending metadata work owned by each request', async () => {
  const release = Promise.withResolvers<boolean>()
  const arrived = new Set<string>()
  const worker = runtime(async (request) => {
    arrived.add(new URL(request.headers.get('x-docs-request')!).pathname.split('/')[1]!)
    await release.promise
    return new Response('')
  })
  const pending = locales.map((locale) => article(worker, locale))
  try {
    await expect.poll(() => arrived.size, { timeout: 5000 }).toBe(2)
    release.resolve(true)
    const results = await Promise.all(pending)
    results.forEach((result, index) => expectArticle(result, locales[index]!))
  } finally {
    release.resolve(true)
    await Promise.allSettled(pending)
    await worker.dispose()
  }
}, 30_000)

it('recovers after the first metadata boundary rejects in the same isolate', async () => {
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
    expect(attempts).toBe(completedAttempts)
  } finally {
    await worker.dispose()
  }
}, 30_000)
