import * as Cloudflare from 'alchemy/Cloudflare'
import * as GitHub from 'alchemy/GitHub'
import * as Output from 'alchemy/Output'
import { Random } from 'alchemy/Random'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import { previewBootstrapConfig } from '../scripts/lib/preview-bootstrap.ts'

export const configurePreview = Effect.fn(function* (
  owner: string,
  repository: string,
  productionAccountId: string
) {
  const preview = yield* previewBootstrapConfig(productionAccountId)
  const publications: Array<GitHub.Secret> = []
  if (preview) {
    const token = yield* Cloudflare.ApiToken.AccountApiToken(
      'preview-deployment-token',
      {
        accountId: preview.accountId,
        name: `${owner}/${repository} preview deployment`,
        policies: preview.policies
      }
    )
    const authSecret = yield* Random('preview-auth-secret', { bytes: 32 })
    for (const name of ['preview', 'preview-cleanup']) {
      const environment = yield* GitHub.Environment(name, {
        owner,
        repository,
        name,
        // Closed-PR cleanup must not depend on approval or a surviving merge ref.
        reviewers: { users: [] },
        preventSelfReview: false,
        waitTimer: 0
      })
      publications.push(
        yield* GitHub.Secret(`${name}-token`, {
          owner,
          repository,
          environment: environment.name,
          name: 'PREVIEW_CLOUDFLARE_API_TOKEN',
          value: token.value
        }),
        yield* GitHub.Secret(`${name}-account`, {
          owner,
          repository,
          environment: environment.name,
          name: 'PREVIEW_CLOUDFLARE_ACCOUNT_ID',
          value: Redacted.make(preview.accountId)
        }),
        yield* GitHub.Secret(`${name}-auth`, {
          owner,
          repository,
          environment: environment.name,
          name: 'PREVIEW_BETTER_AUTH_SECRET',
          value: authSecret.text
        })
      )
    }
  }
  // Publish the repository-level workflow gate only after both environments
  // have their credentials. Environment vars cannot gate job selection.
  return yield* GitHub.Variable('preview-enabled', {
    owner,
    repository,
    name: 'PREVIEW_ENABLED',
    value: preview
      ? Output.map(
          Output.all(...publications.map((secret) => secret.updatedAt)),
          () => 'true'
        )
      : 'false'
  })
})
