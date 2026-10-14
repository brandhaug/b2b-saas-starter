// Failure cases: a production hostname leaking into a preview; auth/analytics
// using a different origin than the deployed Worker; URL/path injection as a host;
// wildcard zone access inferred from an unpinned domain.
import { strict as assert } from 'node:assert'
import { test } from 'vite-plus/test'
import { deploymentOrigins } from '../infra/deployment-origins.ts'

const zoneId = 'c'.repeat(32)
const domains = {
  web: { name: 'app.starter.test', zoneId },
  api: { name: 'api.starter.test', zoneId }
}

test('production URLs follow the declared domains with workers.dev fallbacks', () => {
  assert.deepEqual(deploymentOrigins('prod', 'starter', domains), {
    web: 'https://app.starter.test',
    api: 'https://api.starter.test',
    background: 'https://b2b-saas-starter-background.starter.workers.dev'
  })
})

test('preview URLs never inherit production domains', () => {
  assert.deepEqual(deploymentOrigins('pr-42', 'preview', domains), {
    web: 'https://b2b-saas-starter-pr-42-web.preview.workers.dev',
    api: 'https://b2b-saas-starter-pr-42-api.preview.workers.dev',
    background: 'https://b2b-saas-starter-pr-42-background.preview.workers.dev'
  })
})

test('malformed domains, subdomains, and unpinned zones are rejected', () => {
  for (const name of [
    'https://app.starter.test',
    '*.starter.test',
    'app.starter.test/path',
    'user@app.starter.test'
  ]) {
    assert.throws(() => deploymentOrigins('prod', 'starter', { web: { name, zoneId } }))
  }
  assert.throws(() =>
    deploymentOrigins('prod', 'starter', {
      web: { name: 'app.starter.test', zoneId: '*' }
    })
  )
  assert.throws(() => deploymentOrigins('prod', 'starter\nAPI_URL=bad', {}))
})
