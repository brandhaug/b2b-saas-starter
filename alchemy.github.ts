import * as Alchemy from 'alchemy'
import * as Output from 'alchemy/Output'
import { localState } from 'alchemy/State/LocalState'
import * as GitHub from '@alchemy.run/github'
import { Config, Effect, Layer, Schema } from 'effect'
import { SourceError } from 'effect/ConfigProvider'
import deployment from './deployment.config.ts'
import {
  actionsSettings,
  branchRules,
  labels,
  repositorySettings,
  repositorySecrets
} from './github.config.ts'
import { GitHubControls, GitHubControlsProvider } from './infra/github-controls.ts'

export default Alchemy.Stack(
  'b2b-saas-starter-github',
  {
    providers: GitHubControlsProvider.pipe(Layer.provideMerge(GitHub.providers())),
    state: localState()
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    if (stage !== 'prod') {
      return yield* Effect.fail(
        new Config.ConfigError(
          new SourceError({
            message: 'GitHub repository configuration requires --stage prod'
          })
        )
      )
    }
    const fullName = yield* Config.schema(
      Schema.String.check(
        Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/)
      ),
      'BOOTSTRAP_GITHUB_REPOSITORY'
    )
    const separator = fullName.indexOf('/')
    const owner = fullName.slice(0, separator)
    const repository = fullName.slice(separator + 1)
    const repo = yield* GitHub.Repository('repository', {
      owner,
      name: repository,
      defaultBranch: deployment.production.branch,
      ...repositorySettings
    })
    // The output reference makes settings wait for repository creation/adoption.
    const target = {
      owner,
      repository: Output.map(repo.fullName, (name) => name.slice(name.indexOf('/') + 1))
    }
    yield* GitHub.Ruleset('default-branch', { ...target, ...branchRules })
    yield* GitHubControls('actions', { ...target, ...actionsSettings })
    for (const label of labels) {
      yield* GitHub.Label(`label-${label.name}`, { ...target, ...label })
    }
    for (const name of ['PRIVACY_CONTROLLER_NAME', 'PRIVACY_CONTACT_EMAIL'] as const) {
      const value = deployment.production.variables[name]
      if (value !== undefined) {
        yield* GitHub.Variable(`repository-variable-${name}`, {
          ...target,
          name,
          value
        })
      }
    }
    for (const name of repositorySecrets) {
      yield* GitHub.Secret(`repository-secret-${name}`, {
        ...target,
        name,
        value: yield* Config.Redacted(name)
      })
    }
    return { repository: repo.fullName }
  })
)
