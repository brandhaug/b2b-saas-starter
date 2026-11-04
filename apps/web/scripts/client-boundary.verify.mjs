import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { test } from 'node:test'

// Failure modes: direct imports, re-export chains, relative workspace imports,
// dynamic browser imports, and credentials must fail in the client graph.
// Schema/contracts, erased types, server-fn handlers and server routes must pass.
// Use the actual Start compiler: a mock graph cannot prove handler stripping.
const web = resolve(import.meta.dirname, '..')
const evidence = resolve(web, '../../.context/client-boundary')
mkdirSync(evidence, { recursive: true })
mkdirSync(join(web, '.context'), { recursive: true })

const cases = [
  {
    name: 'mdx-shared-schema',
    mdx: true,
    source: `import { Schema } from 'effect'

export const value = Schema.String

# Shared schema`,
    allowed: true
  },
  {
    name: 'mdx-server-handler',
    mdx: true,
    source: `import { value } from './handler.effects'

export { value }

# Server handler`,
    denied: 'handler.effects'
  },
  {
    name: 'email-delivery-implementation',
    source: `export { makeEmailDelivery as value } from '${resolve(web, '../../packages/email-delivery/src/email-delivery.internal.ts')}'`,
    denied: 'email-delivery.internal'
  },
  {
    name: 'http-api-contract',
    source: `export * as value from '${resolve(web, '../../packages/api/src/errors.ts')}'`,
    allowed: true
  },
  {
    name: 'shared-schema-and-contract',
    source: `import { Schema } from 'effect'
import { ApiTokenId } from '@b2b-saas-starter/db/ids'
import { ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { seedWorkspaceRecord } from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import { createAuthClient } from 'better-auth/react'
import type { Database } from '@b2b-saas-starter/db/service'
export const value = [Schema.is(ApiTokenId)('token'), Schema.is(ApiToken)({}), seedWorkspaceRecord, createAuthClient]`,
    allowed: true
  },
  {
    name: 'compiled-server-handler',
    source: `import { createServerFn } from '@tanstack/react-start'
export const value = createServerFn().handler(async () => {
  const { value } = await import('./handler.effects')
  return value
})`,
    allowed: true
  },
  {
    name: 'direct-database-service',
    source: `export { Database as value } from '@b2b-saas-starter/db/service'`,
    denied: 'db/service'
  },
  {
    name: 'transitive-database-service',
    source: `export { value } from './middle'`,
    denied: 'db/service'
  },
  {
    name: 'relative-database-service',
    source: `export { Database as value } from '${resolve(web, '../../packages/db/src/service.ts')}'`,
    denied: 'db/src/service'
  },
  {
    name: 'dynamic-browser-handler',
    source: `export const value = () => import('./handler.effects')`,
    denied: 'handler.effects'
  },
  {
    name: 'capability-runtime',
    source: `export * as value from '@b2b-saas-starter/capabilities/runtime'`,
    denied: 'capabilities/runtime'
  },
  {
    name: 'capability-adapter',
    source: `export * as value from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry.seed'`,
    denied: 'api-token-registry.seed'
  },
  {
    name: 'monolithic-capability-implementation',
    source: `export * as value from '@b2b-saas-starter/capabilities/governance/account-preferences'`,
    denied: 'account-preferences'
  },
  {
    name: 'server-authentication',
    source: `export * as value from '@b2b-saas-starter/auth'`,
    denied: '@b2b-saas-starter/auth'
  },
  {
    name: 'server-environment',
    source: `export * as value from '@b2b-saas-starter/env/server'`,
    denied: 'env/server'
  },
  {
    name: 'server-credentials',
    source: `import { env } from 'cloudflare:workers'; export const value = env.BETTER_AUTH_SECRET`,
    denied: 'cloudflare:workers'
  }
]

for (const scenario of cases) {
  void test(scenario.name, () => {
    const fixture = mkdtempSync(join(web, '.context/client-boundary-'))
    try {
      mkdirSync(join(fixture, 'src/routes'), { recursive: true })
      mkdirSync(join(fixture, 'shared'), { recursive: true })
      const files = {
        'vite.config.ts': `import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import mdx from '@mdx-js/rollup'
import { clientImportProtection } from '${resolve(web, 'scripts/client-import-protection.ts')}'
export default defineConfig({ plugins: [tanstackStart({ importProtection: clientImportProtection }), { enforce: 'pre', ...mdx() }] })`,
        'src/router.tsx': `import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
export function getRouter() { return createRouter({ routeTree }) }`,
        'src/routes/__root.tsx': `import { createRootRoute } from '@tanstack/react-router'
import { value } from '../probe${scenario.mdx ? '.mdx' : ''}'
export const Route = createRootRoute({ component: () => String(value) })`,
        'src/routes/api.ts': `import { createFileRoute } from '@tanstack/react-router'
import { value } from '../handler.effects'
export const Route = createFileRoute('/api')({ server: { handlers: { GET: () => new Response(value) } } })`,
        'src/handler.effects.ts': `export const value = 'server only'`,
        'src/middle.ts': `export { value } from '../shared/leaf'`,
        'shared/leaf.ts': `export { Database as value } from '@b2b-saas-starter/db/service'`,
        [`src/probe.${scenario.mdx ? 'mdx' : 'ts'}`]: scenario.source
      }
      for (const [path, contents] of Object.entries(files)) {
        writeFileSync(join(fixture, path), contents)
      }
      const result = spawnSync('vp', ['build'], {
        cwd: fixture,
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024
      })
      const output = `${result.stdout}\n${result.stderr}`
      writeFileSync(join(evidence, `${scenario.name}.log`), output)
      assert.ifError(result.error)
      if (scenario.allowed) {
        assert.equal(result.status, 0, output)
      } else {
        assert.notEqual(result.status, 0, output)
        assert.match(
          output,
          /\[import-protection\] Import denied in client environment/
        )
        assert.ok(output.includes(scenario.denied), output)
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
}
