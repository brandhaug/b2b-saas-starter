import assert from 'node:assert/strict'
import { test } from 'vite-plus/test'

import { main, probe } from './smoke-deployment.ts'

function response(status: number, body: string): Response {
  return new Response(body, { status })
}

test('probe retries failed HTTP responses and succeeds after propagation', async () => {
  let attempts = 0
  const sleeps: Array<number> = []
  await probe(
    'api',
    'https://api.example/health',
    async () => {
      attempts += 1
      return response(attempts === 3 ? 200 : 500, 'warming up')
    },
    async (milliseconds) => {
      sleeps.push(milliseconds)
    }
  )
  assert.equal(attempts, 3)
  assert.deepEqual(sleeps, [3000, 3000])
})

test('probe includes the final status and response body in its failure', async () => {
  await assert.rejects(
    () =>
      probe(
        'web',
        'https://web.example/',
        async () => response(500, 'configuration is invalid'),
        async () => {}
      ),
    /smoke probe failed for web \(HTTP 500\)[\s\S]*configuration is invalid/
  )
})

test('main probes the API health endpoint before the web root', async () => {
  const urls: Array<string> = []
  await main(
    { API_URL: 'https://api.example', WEB_URL: 'https://web.example' },
    async (url) => {
      urls.push(url)
      return response(200, 'ok')
    },
    async () => {}
  )
  assert.deepEqual(urls, ['https://api.example/health', 'https://web.example/'])
})
