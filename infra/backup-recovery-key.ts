import { createHash } from 'node:crypto'
import { Octokit } from '@alchemy.run/github/Octokit'
import * as Provider from 'alchemy/Provider'
import { Resource } from 'alchemy/Resource'
import { Config, Effect, Redacted, Schema } from 'effect'
import { SourceError } from 'effect/ConfigProvider'

/** Input has already passed readBackupConfiguration's 32-byte validation. */
export function recoveryKeyFingerprint(key: Redacted.Redacted<string>) {
  const value = Redacted.value(key)
  return createHash('sha256')
    .update(Buffer.from(value, /^[a-f0-9]{64}$/i.test(value) ? 'hex' : 'base64'))
    .digest('hex')
}

export function verifyRecoveryKey(previous: string, next: string) {
  return previous === next
    ? Effect.void
    : Effect.fail(
        new Config.ConfigError(
          new SourceError({
            message:
              'The backup recovery key cannot change. Restore the escrowed key; key rotation requires a separate recovery migration.'
          })
        )
      )
}

type Props = { owner: string; repository: string; fingerprint: string }
type Attributes = { fingerprint: string }
export type BackupRecoveryKey = Resource<'Starter.BackupRecoveryKey', Props, Attributes>
export const BackupRecoveryKey = Resource<BackupRecoveryKey>(
  'Starter.BackupRecoveryKey'
)
const name = 'BACKUP_KEY_FINGERPRINT'
const isNotFound = Schema.is(Schema.Struct({ status: Schema.Literal(404) }))

const readFingerprint = Effect.fn('Backup.readKeyIdentity')(function* (props: Props) {
  const client = yield* Octokit
  return yield* Effect.tryPromise({
    try: async () => {
      try {
        const result = await client.rest.actions.getRepoVariable({
          owner: props.owner,
          repo: props.repository,
          name
        })
        return { fingerprint: result.data.value }
      } catch (error) {
        if (isNotFound(error)) {
          return
        }
        throw error
      }
    },
    catch: (cause) =>
      new Config.ConfigError(
        new SourceError({ message: 'Cannot read backup recovery-key identity', cause })
      )
  })
})

export const BackupRecoveryKeyProvider = Provider.succeed(BackupRecoveryKey, {
  read: Effect.fn(function* ({ olds }) {
    const existing = yield* readFingerprint(olds)
    if (existing) {
      yield* verifyRecoveryKey(existing.fingerprint, olds.fingerprint)
    }
    return existing
  }),
  reconcile: Effect.fn(function* ({ news }) {
    const existing = yield* readFingerprint(news)
    if (existing) {
      yield* verifyRecoveryKey(existing.fingerprint, news.fingerprint)
      return existing
    }
    const client = yield* Octokit
    yield* Effect.tryPromise({
      try: () =>
        client.rest.actions.createRepoVariable({
          owner: news.owner,
          repo: news.repository,
          name,
          value: news.fingerprint
        }),
      catch: (cause) =>
        new Config.ConfigError(
          new SourceError({
            message: 'Cannot persist backup recovery-key identity',
            cause
          })
        )
    })
    return { fingerprint: news.fingerprint }
  }),
  // Preserve the independent identity even if Alchemy's local state is removed.
  delete: () => Effect.void
})
