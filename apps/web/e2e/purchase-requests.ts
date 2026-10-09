/* oxlint-disable effect/noNodeBuiltinImport -- Playwright reads its compiled server-function manifest and uses the installed router serializer. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { type Page } from '@playwright/test'

import { toJSON } from 'seroval'

// No auth, capability, or provider response is intercepted.
export async function submitPurchase(
  page: Page,
  workspaceSlug: string,
  planId = 'team'
) {
  const directory = join(import.meta.dirname, '../dist-e2e/server/assets')
  const manifestName = readdirSync(directory).find((name) =>
    name.startsWith('__23tanstack-start-server-fn-resolver-')
  )
  assert(
    manifestName,
    'Run the built E2E preview to exercise purchase request refusals'
  )
  const manifest = readFileSync(join(directory, manifestName), 'utf8')
  const match = manifest.match(
    /"([a-f0-9]+)":\{functionName:`continuePurchaseServerFn_createServerFn_handler`/
  )
  assert(match?.[1], 'Purchase continuation must exist in the compiled server manifest')
  return page.request.post(`/_serverFn/${match[1]}`, {
    headers: {
      'x-tsr-serverFn': 'true',
      'content-type': 'application/json',
      origin: new URL(page.url()).origin
    },
    data: toJSON({ data: { workspaceSlug, planId } })
  })
}
