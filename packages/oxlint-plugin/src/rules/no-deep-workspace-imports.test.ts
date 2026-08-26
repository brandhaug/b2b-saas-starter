import { assert, describe } from 'vitest'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-deep-workspace-imports')

describe('starter/no-deep-workspace-imports', () => {
  rule.valid(
    'allows a curated subpath import',
    `import { Database } from '@b2b-saas-starter/db/service'`
  )

  rule.valid(
    'allows a bare package root import',
    `import { createAuth } from '@b2b-saas-starter/auth'`
  )

  rule.valid(
    'allows intra-package relative imports',
    `import { unavailable } from '../internal/unavailable.ts'`
  )

  rule.valid(
    'allows third-party src paths outside the workspace scope',
    `import { something } from 'some-package/src/something.js'`
  )

  rule.invalid(
    'reports an import through a workspace package src tree',
    `
			import { schema } from '@b2b-saas-starter/db/src/schema.ts'
		`,
    (messages) => {
      assert.match(messages, /through a src\/ path/)
      assert.match(messages, /@b2b-saas-starter\/db\/schema/)
    }
  )

  rule.invalid(
    'reports a type-only import through a workspace package src tree',
    `
			import type { DrizzleDatabase } from '@b2b-saas-starter/db/src/client.ts'

			export type Use = DrizzleDatabase
		`
  )

  rule.invalid(
    'reports a dynamic import through a workspace package src tree',
    `
			export const load = () => import('@b2b-saas-starter/auth/src/client.ts')
		`
  )
})
