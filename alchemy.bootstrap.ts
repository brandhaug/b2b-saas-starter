import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as GitHub from 'alchemy/GitHub'
import { Random, RandomProvider } from 'alchemy/Random'
import { localState } from 'alchemy/State/LocalState'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'
import { deploymentTokenConfig } from './scripts/lib/deployment-token-policy.ts'
import { productionBootstrapConfig } from './scripts/lib/bootstrap-settings.ts'
import settings from './deployment.config.ts'
import { configurePreview } from './infra/github-preview.ts'
import { emailSettings } from './infra/email-settings.ts'

export default Alchemy.Stack(
  'b2b-saas-starter-deployment-access',
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      GitHub.providers(),
      RandomProvider()
    ),
    // Operator-owned state: no bootstrap credentials in the app's state store.
    // This contains the generated token; preserve it in a protected checkout.
    state: localState()
  },
  Effect.gen(function* () {
    const { accountId, owner, repository, policies, workspaceExportsEnabled } =
      yield* deploymentTokenConfig
    const configured = yield* productionBootstrapConfig(settings.production)
    if (settings.production.emailSending) {
      const sender = emailSettings(settings.production.emailSending)
      configured.variables.push({ name: 'CLOUDFLARE_EMAIL_FROM', value: sender.from })
    }
    yield* configurePreview(owner, repository, accountId)
    const production = yield* GitHub.Environment('production', {
      owner,
      repository,
      name: 'production',
      deploymentBranchPolicy: { customBranchPolicies: [settings.production.branch] },
      reviewers: { users: settings.production.reviewers },
      preventSelfReview: settings.production.reviewers.length > 0
    })
    // Select the name output: whole-resource references can trigger replacement
    // cleanup against the same environment variable or secret on repeat applies.
    yield* GitHub.Variable('production-workspace-exports', {
      owner,
      repository,
      environment: production.name,
      name: 'WORKSPACE_EXPORTS_ENABLED',
      value: String(workspaceExportsEnabled)
    })
    const authSecret = yield* Random('production-auth-secret', { bytes: 32 })
    yield* GitHub.Secret('production-auth-secret-value', {
      owner,
      repository,
      environment: production.name,
      name: 'BETTER_AUTH_SECRET',
      value: authSecret.text
    })
    yield* GitHub.Secret('production-account', {
      owner,
      repository,
      environment: production.name,
      name: 'CLOUDFLARE_ACCOUNT_ID',
      value: Redacted.make(accountId)
    })
    for (const variable of configured.variables) {
      yield* GitHub.Variable(`production-variable-${variable.name}`, {
        owner,
        repository,
        environment: production.name,
        ...variable
      })
    }
    for (const secret of configured.secrets) {
      yield* GitHub.Secret(`production-secret-${secret.name}`, {
        owner,
        repository,
        environment: production.name,
        ...secret
      })
    }
    const token = yield* Cloudflare.ApiToken.AccountApiToken('deployment-token', {
      accountId,
      name: `${owner}/${repository} production deployment`,
      policies
    })

    yield* GitHub.Secret('deployment-token-secret', {
      owner,
      repository,
      name: 'CLOUDFLARE_API_TOKEN',
      value: token.value
    })

    // Never expose the token value in CLI stack outputs.
    return { accountId, tokenId: token.tokenId, repository: `${owner}/${repository}` }
  })
)
