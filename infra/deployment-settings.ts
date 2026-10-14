import {
  type optionalModuleEnvPlainKeys,
  type optionalModuleEnvSecretKeys
} from '../packages/env/src/server.ts'

type VariableName = Exclude<
  (typeof optionalModuleEnvPlainKeys)[number],
  'ENVIRONMENT' | 'GIT_COMMIT_SHA' | 'SERVICE_VERSION'
>
type SecretName = (typeof optionalModuleEnvSecretKeys)[number]

export type ProviderSettings = {
  variables: Partial<Record<VariableName, string>>
  /** Values are read privately from BOOTSTRAP_<name>, never committed here. */
  secrets: ReadonlyArray<SecretName>
}

export type DeploymentSettings = {
  production: ProviderSettings & {
    branch: string
    reviewers: Array<string>
  }
}
