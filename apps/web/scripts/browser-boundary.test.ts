import { describe, expect, it } from 'vite-plus/test'
import { forbiddenBrowserModule } from './browser-boundary'

// Failure inventory: a transitive server import can survive tree-shaking; an
// alias can obscure its import spelling; contract schemas and docs prose are
// legitimate browser inputs and must not trigger substring-based refusals.
describe('browser module ownership', () => {
  it.each([
    '/repo/apps/web/src/lib/server/account.effects.ts',
    '/repo/apps/web/src/http/page-loader.ts?import',
    '/repo/apps/web/src/lib/request-context.ts',
    '/repo/apps/web/src/lib/auth-runtime.ts',
    '/repo/node_modules/.pnpm/react@19.3.1/node_modules/react/index.js',
    '/repo/node_modules/react-dom/client.js',
    '/repo/node_modules/@tanstack/react-start/dist/esm/index.js',
    '/repo/packages/capabilities/src/runtime.ts',
    '/repo/packages/email/src/templates/invitation.tsx'
  ])('rejects executable server or React module %s', (id) => {
    expect(forbiddenBrowserModule(id)).toBe(true)
  })

  it.each([
    '/repo/apps/web/src/http/contracts/account.ts',
    '/repo/apps/web/src/lib/server/account.ts',
    '/repo/node_modules/effect/dist/Schema.js',
    '/repo/apps/web/src/foldkit/program.ts',
    '/repo/apps/web/content/docs/react-migration.mdx',
    '/repo/packages/capabilities/src/developer-platform/webhook-events.ts'
  ])('allows browser contracts, native program and static content %s', (id) => {
    expect(forbiddenBrowserModule(id)).toBe(false)
  })
})
