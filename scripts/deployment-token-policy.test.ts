// Failure cases: wildcard account scope; malformed repository; typo enabling an
// optional grant; unrelated/admin grants; exports widening the account scope.
import { strict as assert } from 'node:assert'
import { test } from 'vite-plus/test'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import { deploymentTokenConfig } from './lib/deployment-token-policy.ts'

const accountId = 'a'.repeat(32)
const environment = {
  CLOUDFLARE_ACCOUNT_ID: accountId,
  BOOTSTRAP_GITHUB_REPOSITORY: 'example/starter'
}

function readConfig(overrides: Record<string, string> = {}) {
  return Effect.runPromise(
    deploymentTokenConfig.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord({ ...environment, ...overrides })
      )
    )
  )
}

test('default deployment policy is restricted to the required account APIs', async () => {
  const config = await readConfig()
  assert.deepEqual(config.policies, [
    {
      effect: 'allow',
      permissionGroups: [
        'Workers Scripts Write',
        'D1 Write',
        'Secrets Store Write',
        'Account Settings Write'
      ],
      resources: { [`com.cloudflare.api.account.${accountId}`]: '*' }
    }
  ])
  assert.equal(config.owner, 'example')
  assert.equal(config.repository, 'starter')
})

test('exports adds only R2 administration in the same account', async () => {
  const disabled = await readConfig({ WORKSPACE_EXPORTS_ENABLED: 'false' })
  const enabled = await readConfig({ WORKSPACE_EXPORTS_ENABLED: 'true' })
  assert.deepEqual(enabled.policies, [
    {
      ...disabled.policies[0],
      permissionGroups: [
        ...disabled.policies[0]!.permissionGroups,
        'Workers R2 Storage Write'
      ]
    }
  ])
})

test('invalid account scopes and repository destinations fail before provisioning', async () => {
  for (const value of [
    '',
    '*',
    'a'.repeat(31),
    'g'.repeat(32),
    `${accountId}.zone.*`
  ]) {
    await assert.rejects(readConfig({ CLOUDFLARE_ACCOUNT_ID: value }))
  }
  for (const value of ['', 'owner', 'owner/repo/extra', '*/repo', 'owner/..']) {
    await assert.rejects(readConfig({ BOOTSTRAP_GITHUB_REPOSITORY: value }))
  }
  await assert.rejects(readConfig({ WORKSPACE_EXPORTS_ENABLED: 'yes' }))
})
