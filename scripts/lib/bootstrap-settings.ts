import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import * as Schema from 'effect/Schema'
import { type ProviderSettings } from '../../infra/deployment-settings.ts'

function actionsName(name: string): string {
  return name.startsWith('GITHUB_') ? `OAUTH_${name}` : name
}

export const productionBootstrapConfig = Effect.fn(function* (
  settings: ProviderSettings
) {
  const secrets = yield* Effect.forEach(settings.secrets, (name) =>
    Config.schema(Schema.NonEmptyString, `BOOTSTRAP_${name}`).pipe(
      Effect.map((value) => ({ name: actionsName(name), value: Redacted.make(value) }))
    )
  )
  const variables = Object.entries(settings.variables).map(([name, value]) => ({
    name: actionsName(name),
    value
  }))
  return { variables, secrets }
})
