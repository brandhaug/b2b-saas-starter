import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-mismatched-augmentation-context', {
  filename: 'fixture.d.ts'
})

describe('starter/no-mismatched-augmentation-context', () => {
  rule.valid(
    'allows module augmentation when a top-level import makes the file a module',
    `import { type Router } from './router'
declare module '@tanstack/react-router' {
  interface Register {
    router: Router
  }
}`
  )

  rule.valid(
    'allows module augmentation behind a bare export marker',
    `export {}
declare module 'some-lib' {
  interface Thing {
    a: 1
  }
}`
  )

  rule.valid(
    'allows a global namespace declaration in a global script',
    `type WorkerEnv = {
  readonly DB?: import('@cloudflare/workers-types').D1Database
}
declare namespace Cloudflare {
  interface Env extends WorkerEnv {}
}`
  )

  rule.valid(
    'allows declare global in a global script',
    `declare global {
  var localD1: string | undefined
}`
  )

  rule.valid(
    'ignores files that are not declaration files',
    `declare global {
  var localD1: string | undefined
}
export const x = 1`,
    { filename: 'fixture.ts' }
  )

  rule.invalid(
    'reports module augmentation in a global script',
    `declare module '@tanstack/react-router' {
  interface Register {
    router: string
  }
}`,
    (messages) => {
      assert.match(messages, /no top-level import or export/)
      assert.match(messages, /declares a new ambient module/)
    }
  )

  rule.invalid(
    'reports declare global inside a module',
    `import { type D1Database } from '@cloudflare/workers-types'
declare global {
  var localD1: Promise<D1Database | undefined> | undefined
}`,
    (messages) => {
      assert.match(messages, /never reaches the global scope/)
    }
  )

  rule.invalid(
    'reports a namespace declaration inside a module',
    `import { type ServerEnv } from '@b2b-saas-starter/env/server'
declare namespace Cloudflare {
  interface Env {
    readonly vars: ServerEnv
  }
}`,
    (messages) => {
      assert.match(messages, /inline `import\(\)` types/)
    }
  )
})
