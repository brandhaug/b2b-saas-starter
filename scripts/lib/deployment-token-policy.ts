import { type Policy, type PermissionGroupRef } from 'alchemy/Cloudflare/ApiToken'
import * as Config from 'effect/Config'
import * as Schema from 'effect/Schema'

const accountIdConfig = Config.schema(
  Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
  'CLOUDFLARE_ACCOUNT_ID'
)
const githubRepositoryConfig = Config.schema(
  Schema.String.check(
    Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/)
  ),
  'BOOTSTRAP_GITHUB_REPOSITORY'
)
const workspaceExportsConfig = Config.schema(
  Schema.Literals(['true', 'false']),
  'WORKSPACE_EXPORTS_ENABLED'
).pipe(Config.withDefault('false'))

/** Only APIs used by the production stack and its Cloudflare state backend. */
export const deploymentTokenConfig = Config.all({
  accountId: accountIdConfig,
  githubRepository: githubRepositoryConfig,
  workspaceExports: workspaceExportsConfig
}).pipe(
  Config.map(({ accountId, githubRepository, workspaceExports }) => {
    const separator = githubRepository.indexOf('/')
    const owner = githubRepository.slice(0, separator)
    const repository = githubRepository.slice(separator + 1)
    const permissionGroups: Array<PermissionGroupRef> = [
      // Includes Worker assets, bindings, cron schedules, queues and consumers.
      'Workers Scripts Write',
      'D1 Write',
      // Cloudflare.state() creates/upgrades its authentication and encryption secrets.
      'Secrets Store Write',
      // Web Analytics site management; no zone access for the workers.dev host.
      'Account Settings Write',
      // RUM listing requires Read explicitly; Write alone returns HTTP 403.
      'Account Settings Read'
    ]
    if (workspaceExports === 'true') {
      permissionGroups.push('Workers R2 Storage Write')
    }
    const policies: Array<Policy> = [
      {
        effect: 'allow',
        permissionGroups,
        resources: { [`com.cloudflare.api.account.${accountId}`]: '*' }
      }
    ]
    return {
      accountId,
      owner,
      repository,
      policies,
      workspaceExportsEnabled: workspaceExports === 'true'
    }
  })
)
