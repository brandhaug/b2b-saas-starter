// Failure cases: running the operator stack with no sender; wildcard zone;
// sender path/credential injection; deriving a different domain than the From address.
import { strict as assert } from 'node:assert'
import { test } from 'vite-plus/test'
import { emailSettings } from '../infra/email-settings.ts'

test('email configuration pins the domain to the exact sender and zone', () => {
  assert.deepEqual(
    emailSettings({ zoneId: 'c'.repeat(32), from: 'notifications@mail.starter.test' }),
    {
      zoneId: 'c'.repeat(32),
      from: 'notifications@mail.starter.test',
      domain: 'mail.starter.test'
    }
  )
})

test('unconfigured or invalid email provisioning fails before remote requests', () => {
  assert.throws(() => emailSettings(undefined))
  assert.throws(() =>
    emailSettings({ zoneId: '*', from: 'notifications@mail.starter.test' })
  )
  for (const from of [
    'not-an-email',
    'a@mail.starter.test/path',
    'a@b@mail.starter.test',
    'a@*.starter.test'
  ]) {
    assert.throws(() => emailSettings({ zoneId: 'c'.repeat(32), from }))
  }
})
