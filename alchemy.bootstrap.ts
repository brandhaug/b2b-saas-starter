import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as GitHub from 'alchemy/GitHub'
import { localState } from 'alchemy/State/LocalState'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { deploymentTokenConfig } from './scripts/lib/deployment-token-policy.ts'

export default Alchemy.Stack(
  'b2b-saas-starter-deployment-access',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    // Operator-owned state: no bootstrap credentials in the app's state store.
    // This contains the generated token; preserve it in a protected checkout.
    state: localState()
  },
  Effect.gen(function* () {
    const { accountId, owner, repository, policies } = yield* deploymentTokenConfig
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
