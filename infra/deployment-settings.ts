import {
  type optionalModuleEnvPlainKeys,
  type optionalModuleEnvSecretKeys
} from '../packages/env/src/server.ts'
import { type DeploymentDomains } from './deployment-origins.ts'
import { type EmailSettings } from './email-settings.ts'

type VariableName = Exclude<
  (typeof optionalModuleEnvPlainKeys)[number],
  | 'ENVIRONMENT'
  | 'GIT_COMMIT_SHA'
  | 'SERVICE_VERSION'
  | 'API_PUBLIC_URL'
  | 'CLOUDFLARE_EMAIL_FROM'
>
type SecretName = (typeof optionalModuleEnvSecretKeys)[number]

export type ProviderSettings = {
  variables: Partial<Record<VariableName, string>>
  /** Values are read privately from BOOTSTRAP_<name>, never committed here. */
  secrets: ReadonlyArray<SecretName>
}

export type DeploymentSettings = {
  production: ProviderSettings & {
    /** Must match ci.yml's production push and dispatch branch. */
    branch: 'master'
    reviewers: Array<string>
    domains?: DeploymentDomains
    emailSending?: EmailSettings
  }
}
