import { createHash } from 'node:crypto'
import * as Alchemy from 'alchemy'
import * as Output from 'alchemy/Output'
import { retain } from 'alchemy/RemovalPolicy'
import { localState } from 'alchemy/State/LocalState'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as GitHub from '@alchemy.run/github'
import { Effect, Layer, Redacted } from 'effect'
import settings from './backup.config.ts'
import {
  BackupRecoveryKey,
  BackupRecoveryKeyProvider,
  recoveryKeyFingerprint
} from './infra/backup-recovery-key.ts'
import {
  backupConfigurationError,
  readBackupConfiguration
} from './infra/backup-settings.ts'

export const Stack = Alchemy.Stack(
  'b2b-saas-starter-backup',
  {
    providers: BackupRecoveryKeyProvider.pipe(
      Layer.provideMerge(Layer.merge(Cloudflare.providers(), GitHub.providers()))
    ),
    state: localState()
  },
  Effect.gen(function* () {
    if ((yield* Alchemy.Stage) !== 'prod') {
      return yield* backupConfigurationError(
        'Backup infrastructure requires --stage prod'
      )
    }
    const config = yield* readBackupConfiguration(settings)
    if (!config) {
      return { enabled: false }
    }

    // R2.Bucket uses the provider account, rather than a per-resource override.
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment
    if (accountId !== config.backupAccountId) {
      return yield* backupConfigurationError(
        'Alchemy profile must select the configured backup account'
      )
    }

    const bucket = yield* Cloudflare.R2.Bucket('backup-storage', {
      name: config.bucketName,
      jurisdiction: 'default',
      publicAccess: false,
      forceDestroy: false,
      // Completion-record authentication and newest-30-days pruning own deletion.
      lifecycleRules: []
    }).pipe(retain())

    const sourceToken = yield* Cloudflare.ApiToken.AccountApiToken('backup-d1-reader', {
      accountId: config.productionAccountId,
      policies: [
        {
          effect: 'allow',
          permissionGroups: ['D1 Read'],
          resources: {
            [`com.cloudflare.api.account.${config.productionAccountId}`]: '*'
          }
        }
      ]
    })
    const storageToken = yield* Cloudflare.ApiToken.AccountApiToken(
      'backup-object-writer',
      {
        accountId: config.backupAccountId,
        policies: [
          {
            effect: 'allow',
            permissionGroups: [
              'Workers R2 Storage Bucket Item Read',
              'Workers R2 Storage Bucket Item Write'
            ],
            resources: Output.map(bucket.bucketName, (name) => ({
              [`com.cloudflare.edge.r2.bucket.${config.backupAccountId}_default_${name}`]:
                '*'
            }))
          }
        ]
      }
    )

    const repository = { owner: config.owner, repository: config.repository }
    const environment = yield* GitHub.Environment('backup-environment', {
      ...repository,
      name: 'backup',
      deploymentBranchPolicy: { customBranchPolicies: [config.defaultBranch] }
    })
    const recoveryKey = yield* BackupRecoveryKey('recovery-key-identity', {
      ...repository,
      fingerprint: recoveryKeyFingerprint(config.encryptionKey)
    })
    const secrets = {
      BACKUP_CLOUDFLARE_API_TOKEN: sourceToken.value,
      BACKUP_CLOUDFLARE_ACCOUNT_ID: Redacted.make(config.productionAccountId),
      BACKUP_S3_BUCKET: Output.map(bucket.bucketName, Redacted.make),
      BACKUP_S3_ENDPOINT: Redacted.make(
        `https://${config.backupAccountId}.r2.cloudflarestorage.com`
      ),
      BACKUP_S3_ACCESS_KEY_ID: Output.map(storageToken.tokenId, Redacted.make),
      // Cloudflare's S3 token derivation, also used by the SDK's Worker-only helper.
      BACKUP_S3_SECRET_ACCESS_KEY: Output.map(storageToken.value, (value) =>
        Redacted.make(createHash('sha256').update(Redacted.value(value)).digest('hex'))
      ),
      BACKUP_ENCRYPTION_KEY: Output.map(
        recoveryKey.fingerprint,
        () => config.encryptionKey
      )
    }
    const dependencies: Array<Output.Output<string>> = []
    for (const [name, value] of Object.entries(secrets)) {
      const secret = yield* GitHub.Secret(name, {
        ...repository,
        environment: environment.name,
        name,
        value
      })
      dependencies.push(secret.updatedAt)
    }
    for (const [name, value] of Object.entries({
      BACKUP_DATABASE: config.database,
      BACKUP_S3_PREFIX: config.prefix,
      BACKUP_S3_REGION: 'auto'
    })) {
      const variable = yield* GitHub.Variable(name, {
        ...repository,
        environment: environment.name,
        name,
        value
      })
      dependencies.push(variable.updatedAt)
    }
    // Resource declaration order is insufficient: outputs establish apply order.
    yield* GitHub.Variable('backup-enabled', {
      ...repository,
      name: 'BACKUP_ENABLED',
      value: Output.all(...dependencies).pipe(Output.map(() => 'true'))
    })
    return { enabled: true, bucket: bucket.bucketName }
  })
)

export default Stack
