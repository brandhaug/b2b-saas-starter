import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vite-plus/test'

import { main } from './smoke-deployment.ts'

// Failure inventory, written before implementation: stale/missing identity,
// invalid health JSON/schema, login HTML, redirects, absent/HTML assets,
// stalled headers/body, unavailable origin, missing configuration, and partial
// propagation must never produce a passed artifact. Exercise real HTTP and disk.
const commit = 'a'.repeat(40)
const html =
  '<html><meta name="deployment-page" content="public-home"><link rel="stylesheet" href="/assets/app.css"></html>'

for (const scenario of [
  'healthy',
  'canonical-locale',
  'propagating',
  'stale',
  'missing',
  'malformed',
  'login',
  'redirect',
  'asset',
  'malformed-asset-url',
  'timeout',
  'body-timeout',
  'unavailable',
  'configuration'
]) {
  test(`deployment evidence: ${scenario}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'smoke-'))
    let healthRequests = 0
    const server = createServer((request, response) => {
      if (scenario === 'timeout') {
        return
      }
      if (scenario === 'unavailable') {
        request.socket.destroy()
        return
      }
      if (request.url === '/health') {
        healthRequests += 1
      }
      response.setHeader(
        'x-deployment-commit',
        scenario === 'stale' || (scenario === 'propagating' && healthRequests === 1)
          ? 'b'.repeat(40)
          : commit
      )
      response.setHeader('x-deployment-version', 'test-build')
      if (scenario === 'missing') {
        response.removeHeader('x-deployment-commit')
      }
      if (scenario === 'redirect') {
        response.writeHead(302, { location: '/login' })
        response.end()
        return
      }
      if (scenario === 'canonical-locale' && request.url === '/') {
        response.writeHead(307, { location: '/en' })
        response.end()
        return
      }
      if (scenario === 'body-timeout') {
        response.writeHead(200)
        response.write('partial')
        return
      }
      if (request.url === '/health') {
        response.setHeader('content-type', 'application/json')
        response.end(
          scenario === 'malformed' ? '{"status":"healthy"}' : '{"status":"ok"}'
        )
      } else if (request.url === '/' || request.url === '/en') {
        response.setHeader('content-type', 'text/html')
        let page = html
        if (scenario === 'login') {
          page = '<html>Login</html>'
        }
        if (scenario === 'malformed-asset-url') {
          page = html.replace('/assets/app.css', 'http://[invalid')
        }
        response.end(page)
      } else {
        response.setHeader(
          'content-type',
          scenario === 'asset' ? 'text/html' : 'text/css'
        )
        response.end(
          scenario === 'asset' ? '<html>Login</html>' : 'body { color: black }'
        )
      }
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- node:http returns a union with Unix socket strings; this test explicitly binds a TCP port
    assert.ok(address && typeof address !== 'string')
    const url = `http://127.0.0.1:${address.port}`
    const evidencePath = join(directory, 'evidence.json')
    try {
      const run = main(
        {
          API_URL: url,
          WEB_URL: url,
          GIT_COMMIT_SHA: scenario === 'configuration' ? '' : commit,
          SERVICE_VERSION: 'test-build'
        },
        { evidencePath, deadlineMs: 250, requestTimeoutMs: 50, retryDelayMs: 10 }
      )
      const passes = ['healthy', 'propagating', 'canonical-locale'].includes(scenario)
      if (passes) {
        await run
      } else {
        await assert.rejects(run, /deployment smoke/)
      }
      const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
      let expectedOutcome = 'failed'
      if (passes) {
        expectedOutcome = 'passed'
      } else if (
        ['missing', 'timeout', 'body-timeout', 'unavailable', 'configuration'].includes(
          scenario
        )
      ) {
        expectedOutcome = 'unknown'
      }
      assert.equal(evidence.outcome, expectedOutcome)
      assert.ok(evidence.startedAt && evidence.completedAt)
      if (scenario !== 'configuration') {
        assert.equal(evidence.expected.commit, commit)
        assert.ok(evidence.attempts.length > 0)
        assert.ok(evidence.attempts[0].observedAt)
      }
      if (scenario === 'propagating') {
        assert.ok(evidence.attempts.length > 1)
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      await rm(directory, { recursive: true, force: true })
    }
  })
}
