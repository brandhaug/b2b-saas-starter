import { type BackupSettings } from './infra/backup-settings.ts'

/** Operator-owned destinations. Never put credentials or the recovery key here. */
export default {
  enabled: false,
  owner: '',
  repository: '',
  defaultBranch: 'main',
  productionAccountId: '',
  backupAccountId: '',
  bucketName: '',
  database: 'b2b-saas-starter',
  prefix: 'd1'
} satisfies BackupSettings
