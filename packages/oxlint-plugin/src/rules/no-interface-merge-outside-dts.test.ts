import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-interface-merge-outside-dts')

describe('starter/no-interface-merge-outside-dts', () => {
  rule.valid(
    'allows a module augmentation in a declaration file',
    `import { type Router } from './router'
declare module '@tanstack/react-router' {
  interface Register {
    router: Router
  }
}`,
    { filename: 'register.d.ts' }
  )

  rule.valid(
    'allows a global var slot in a module, which needs no interface',
    `import { type D1Database } from '@cloudflare/workers-types'
declare global {
  var localD1: Promise<D1Database | undefined> | undefined
}
export const x = 1`
  )

  rule.valid(
    'allows a plain type alias outside a declaration file',
    `type Register = { router: string }
export type { Register }`
  )

  rule.valid(
    'allows an interface inside a declaration file namespace',
    `declare namespace Cloudflare {
  interface Env {
    DB?: string
  }
}`,
    { filename: 'worker-env.d.ts' }
  )

  rule.invalid(
    'reports a module augmentation interface in a .ts file',
    `declare module 'some-lib' {
  interface Thing {
    a: 1
  }
}`,
    (messages) => {
      assert.match(messages, /Move this declaration merge into a \.d\.ts file/)
      assert.match(messages, /pnpm run check:fix/)
    }
  )

  rule.invalid(
    'reports an interface inside declare global in a .tsx file',
    `declare global {
  interface Window {
    starter: string
  }
}
export const Component = () => null`,
    undefined,
    { filename: 'fixture.tsx' }
  )

  rule.invalid(
    'reports an interface inside a declare namespace in a .ts file',
    `declare namespace Cloudflare {
  interface Env {
    DB?: string
  }
}`
  )
})
