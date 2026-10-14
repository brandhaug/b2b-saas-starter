// Failure cases: previews granted production-account access; wildcard account;
// absent preview config accidentally enabling jobs; runtime-provider grants leaking.
import { strict as assert } from 'node:assert'
import { test } from 'vite-plus/test'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import { previewBootstrapConfig } from './lib/preview-bootstrap.ts'

const productionAccount = 'a'.repeat(32)
const previewAccount = 'b'.repeat(32)

function readPreview(environment: Record<string, string>) {
  return Effect.runPromise(
    previewBootstrapConfig(productionAccount).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord(environment)
      )
    )
  )
}

test('an unconfigured preview account leaves previews disabled', async () => {
  assert.equal(await readPreview({}), null)
  assert.equal(await readPreview({ BOOTSTRAP_PREVIEW_ACCOUNT_ID: '' }), null)
})

test('preview credentials cannot target production or wildcard accounts', async () => {
  for (const accountId of [productionAccount, '*', 'b'.repeat(31)]) {
    await assert.rejects(readPreview({ BOOTSTRAP_PREVIEW_ACCOUNT_ID: accountId }))
  }
})

test('preview policy includes only infrastructure APIs in the separate account', async () => {
  const preview = await readPreview({ BOOTSTRAP_PREVIEW_ACCOUNT_ID: previewAccount })
  assert.deepEqual(preview, {
    accountId: previewAccount,
    policies: [
      {
        effect: 'allow',
        permissionGroups: ['Workers Scripts Write', 'D1 Write', 'Secrets Store Write'],
        resources: { [`com.cloudflare.api.account.${previewAccount}`]: '*' }
      }
    ]
  })
})
