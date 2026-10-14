// Failure cases: absent selected secrets; accidental dev-env secret import;
// leaking secret text into variables; GitHub's reserved GITHUB_ names.
import { strict as assert } from 'node:assert'
import { test } from 'vite-plus/test'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import { productionBootstrapConfig } from './lib/bootstrap-settings.ts'

test('unselected provider secrets remain inactive even if present in the shell', async () => {
  const config = await Effect.runPromise(
    productionBootstrapConfig({ variables: {}, secrets: [] }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord({ STRIPE_SECRET_KEY: 'local-development-value' })
      )
    )
  )
  assert.deepEqual(config, { variables: [], secrets: [] })
})

test('selected secrets must be explicitly supplied through bootstrap inputs', async () => {
  await assert.rejects(
    Effect.runPromise(
      productionBootstrapConfig({ variables: {}, secrets: ['STRIPE_SECRET_KEY'] }).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnvRecord({ STRIPE_SECRET_KEY: 'local-development-value' })
        )
      )
    )
  )
})

test('OAuth names are mapped and secret values remain redacted', async () => {
  const config = await Effect.runPromise(
    productionBootstrapConfig({
      variables: { GITHUB_CLIENT_ID: 'public-id', SUPPORT_EMAIL: 'help@starter.test' },
      secrets: ['GITHUB_CLIENT_SECRET']
    }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord({
          BOOTSTRAP_GITHUB_CLIENT_SECRET: 'private-value'
        })
      )
    )
  )
  assert.deepEqual(config.variables, [
    { name: 'OAUTH_GITHUB_CLIENT_ID', value: 'public-id' },
    { name: 'SUPPORT_EMAIL', value: 'help@starter.test' }
  ])
  assert.equal(config.secrets[0]?.name, 'OAUTH_GITHUB_CLIENT_SECRET')
  assert.equal(Redacted.isRedacted(config.secrets[0].value), true)
  assert.equal(JSON.stringify(config).includes('private-value'), false)
})
