import { expect, test } from '@playwright/test'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { isolatedClientIp } from './test-isolation'

test('raw organization endpoints cannot bypass workspace capability checks', async ({
  request,
  baseURL
}, testInfo) => {
  test.skip(!hasLocalD1State(), 'requires the migrated and seeded local D1')
  const headers = {
    origin: new URL('/sign-in', baseURL).origin,
    'cf-connecting-ip': isolatedClientIp(testInfo.testId)
  }
  const login = await request.post('/api/auth/sign-in/email', {
    headers,
    data: { email: 'demo@starter.local', password: 'demo-starter-password' }
  })
  expect(login.status()).toBe(200)

  const read = await request.get('/api/auth/organization/get-full-organization', {
    headers,
    params: { organizationSlug: 'starter-lab' }
  })
  expect(read.status()).toBe(404)
  expect(await read.json()).toEqual({ code: 'not_found' })
  const mutation = await request.post('/api/auth/organization/update', {
    headers,
    data: {}
  })
  expect(mutation.status()).toBe(404)

  // Closing the plugin's workspace routes does not disable account sessions.
  const account = await request.get('/api/auth/get-session', { headers })
  expect(account.status()).toBe(200)
  expect(await account.json()).toMatchObject({ user: { email: 'demo@starter.local' } })
})
