import assert from 'node:assert/strict'
import { test } from 'vite-plus/test'
import { ConfigProvider, Effect, Redacted } from 'effect'
import { readBackupConfiguration } from '../infra/backup-settings.ts'
import {
  recoveryKeyFingerprint,
  verifyRecoveryKey
} from '../infra/backup-recovery-key.ts'

// Failure cases established before implementation: disabled configuration reads
// credentials, same-account storage, wrong active account, absent/replaced key,
// malformed key, or incomplete destination configuration reaching provisioning.
const settings = {
  enabled: true,
  owner: 'example',
  repository: 'starter',
  defaultBranch: 'main',
  productionAccountId: 'a'.repeat(32),
  backupAccountId: 'b'.repeat(32),
  bucketName: 'independent-d1-backups',
  database: 'b2b-saas-starter',
  prefix: 'd1'
}
const key = 'ab'.repeat(32)

test('persisted recovery identity accepts equivalent encoding and rejects a different valid key', () => {
  const previous = recoveryKeyFingerprint(Redacted.make(key))
  const equivalent = recoveryKeyFingerprint(
    Redacted.make(Buffer.from(key, 'hex').toString('base64'))
  )
  assert.equal(previous, equivalent)
  Effect.runSync(verifyRecoveryKey(previous, equivalent))
  const changed = recoveryKeyFingerprint(Redacted.make('cd'.repeat(32)))
  const configFailure = Effect.runSync(
    Effect.flip(verifyRecoveryKey(previous, changed))
  )
  assert.match(configFailure.message, /recovery key cannot change/)
})
function read(input = settings, env: Record<string, string> = {}) {
  return readBackupConfiguration(input).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          CLOUDFLARE_ACCOUNT_ID: settings.backupAccountId,
          ...env
        })
      )
    )
  )
}

test('disabled stack needs neither destination configuration nor secrets', () =>
  Effect.gen(function* () {
    assert.equal(yield* read({ ...settings, enabled: false, owner: '' }), undefined)
  }).pipe(Effect.runSync))

test('same production and backup account is rejected', () =>
  Effect.gen(function* () {
    const configFailure = yield* Effect.flip(
      read({ ...settings, backupAccountId: settings.productionAccountId })
    )
    assert.match(configFailure.message, /different Cloudflare account/)
  }).pipe(Effect.runSync))

test('missing encryption key fails instead of generating a replacement', () =>
  Effect.gen(function* () {
    const configFailure = yield* Effect.flip(read())
    assert.match(configFailure.message, /BACKUP_ENCRYPTION_KEY/)
  }).pipe(Effect.runSync))

test('wrong active account fails before provisioning', () =>
  Effect.gen(function* () {
    const configFailure = yield* Effect.flip(
      read(settings, {
        CLOUDFLARE_ACCOUNT_ID: settings.productionAccountId,
        BACKUP_ENCRYPTION_KEY: key
      })
    )
    assert.match(configFailure.message, /backup account/)
  }).pipe(Effect.runSync))

test('invalid key fails without including its value in the error', () =>
  Effect.gen(function* () {
    const invalid = 'private-but-invalid-key'
    const configFailure = yield* Effect.flip(
      read(settings, { BACKUP_ENCRYPTION_KEY: invalid })
    )
    assert.match(configFailure.message, /32 bytes/)
    assert.ok(!configFailure.message.includes(invalid))
  }).pipe(Effect.runSync))

test('existing hex and base64 encryption keys are preserved verbatim', () =>
  Effect.gen(function* () {
    for (const value of [key, Buffer.from(key, 'hex').toString('base64')]) {
      const result = yield* read(settings, { BACKUP_ENCRYPTION_KEY: value })
      assert.ok(result)
      assert.equal(Redacted.value(result.encryptionKey), value)
    }
  }).pipe(Effect.runSync))

test('incomplete destinations fail before reading credentials', () =>
  Effect.gen(function* () {
    const configFailure = yield* Effect.flip(read({ ...settings, owner: '' }))
    assert.match(configFailure.message, /owner/)
  }).pipe(Effect.runSync))
