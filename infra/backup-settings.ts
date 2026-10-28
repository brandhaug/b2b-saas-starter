import { Config, Effect, Redacted } from 'effect'
import { SourceError } from 'effect/ConfigProvider'

export type BackupSettings = {
  readonly enabled: boolean
  readonly owner: string
  readonly repository: string
  readonly defaultBranch: string
  readonly productionAccountId: string
  readonly backupAccountId: string
  readonly bucketName: string
  readonly database: string
  readonly prefix: string
}

export function backupConfigurationError(message: string) {
  return Effect.fail(new Config.ConfigError(new SourceError({ message })))
}

export const readBackupConfiguration = Effect.fn('Backup.readConfiguration')(function* (
  settings: BackupSettings
) {
  const enabled = yield* Config.Boolean('BACKUP_INFRA_ENABLED').pipe(
    Config.withDefault(settings.enabled)
  )
  if (!enabled) {
    return
  }

  const { enabled: configuredEnabled, ...destinations } = settings
  void configuredEnabled
  for (const [name, value] of Object.entries(destinations)) {
    if (!value.trim() || value !== value.trim()) {
      return yield* backupConfigurationError(`Configure backup ${name}`)
    }
  }
  for (const id of [settings.productionAccountId, settings.backupAccountId]) {
    if (!/^[a-f0-9]{32}$/i.test(id)) {
      return yield* backupConfigurationError(
        'Cloudflare account IDs must be 32 hex characters'
      )
    }
  }
  if (
    settings.productionAccountId.toLowerCase() ===
    settings.backupAccountId.toLowerCase()
  ) {
    return yield* backupConfigurationError(
      'Backups require a different Cloudflare account from production'
    )
  }
  const activeAccountId = yield* Config.String('CLOUDFLARE_ACCOUNT_ID')
  if (activeAccountId !== settings.backupAccountId) {
    return yield* backupConfigurationError(
      'CLOUDFLARE_ACCOUNT_ID must select the backup account'
    )
  }
  const encryptionKey = yield* Config.Redacted('BACKUP_ENCRYPTION_KEY')
  const raw = Redacted.value(encryptionKey)
  const validHex = /^[a-f0-9]{64}$/i.test(raw)
  const validBase64 =
    /^[A-Za-z0-9+/]{43}=$/.test(raw) &&
    Buffer.from(raw, 'base64').length === 32 &&
    Buffer.from(raw, 'base64').toString('base64') === raw
  if (!validHex && !validBase64) {
    return yield* backupConfigurationError(
      'BACKUP_ENCRYPTION_KEY must encode exactly 32 bytes as hex or standard base64'
    )
  }
  return { ...settings, encryptionKey }
})
