// Failure modes before implementation: a foreign zone is mutated, a name escapes
// its zone, duplicate resource identities overlap, or records overwrite Worker DNS.
import assert from 'node:assert/strict'
import { test } from 'vite-plus/test'
import { validateDnsRecords } from '../infra/dns-settings.ts'

const zone = {
  id: 'a'.repeat(32),
  name: 'example.com',
  account: { id: 'b'.repeat(32) }
}
const record = {
  key: 'verification',
  zoneId: zone.id,
  type: 'TXT',
  name: '_verify.example.com',
  content: 'public-verification'
}

test('accepts zone-scoped records and rejects foreign account or escaped hostnames', () => {
  assert.doesNotThrow(() => validateDnsRecords(zone.account.id, [record], [zone], {}))
  assert.throws(
    () => validateDnsRecords('c'.repeat(32), [record], [zone], {}),
    /account/
  )
  assert.throws(
    () =>
      validateDnsRecords(
        zone.account.id,
        [{ ...record, name: 'otherexample.com' }],
        [zone],
        {}
      ),
    /zone/
  )
})

test('rejects duplicate IDs and names managed by Worker custom domains', () => {
  assert.throws(
    () =>
      validateDnsRecords(
        zone.account.id,
        [record, { ...record, key: 'other' }],
        [zone],
        {}
      ),
    /duplicate/
  )
  assert.throws(
    () => validateDnsRecords(zone.account.id, [record, record], [zone], {}),
    /unique/
  )
  assert.throws(
    () =>
      validateDnsRecords(
        zone.account.id,
        [{ ...record, name: 'app.example.com' }],
        [zone],
        { web: { name: 'app.example.com', zoneId: zone.id } }
      ),
    /Worker/
  )
})

test('rejects noncanonical names and unsupported sibling ownership before native adoption', () => {
  for (const name of ['_VERIFY.example.com', '_verify.example.com.']) {
    assert.throws(
      () => validateDnsRecords(zone.account.id, [{ ...record, name }], [zone], {}),
      /canonical/
    )
  }
  assert.throws(
    () =>
      validateDnsRecords(
        zone.account.id,
        [record, { ...record, key: 'sibling', content: 'different-value' }],
        [zone],
        {}
      ),
    /duplicate/
  )
})
