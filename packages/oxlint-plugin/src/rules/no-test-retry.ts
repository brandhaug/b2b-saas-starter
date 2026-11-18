import { defineRule, type ESTree } from 'vite-plus/lint/plugins'
import {
  getPropertyName,
  isMemberOf,
  staticPropertyKey,
  unwrapExpression
} from '../internal/ast.ts'
import { isTestDeclaration } from '../internal/test-call.ts'

/**
 * Catches test retries: a non-zero `retry` in test, `it`, `describe` or `suite`
 * options, in `vi.setConfig`, or in a Vitest `test: { ... }` configuration
 * block, and a non-zero top-level `retries` in Playwright's `defineConfig`. A
 * test that passes on rerun is a flake, and a retry turns its first-attempt
 * evidence into a green check. `no-browser-test-inflation` covers per-describe
 * Playwright retries.
 *
 * Test calls match by runner name (see `test-call.ts`). Dynamic keys, spread
 * options, the `--retry` CLI flag and per-project Playwright `retries` are left
 * to review. Adapted from `@interfere/landmines` (see `third-party-licenses.md`).
 */

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow test retries in test options and runner configuration.'
    }
  },
  create(context) {
    const playwrightConfigs = new Set<string>()

    function inspect(options: ESTree.Node | undefined, key: string): void {
      const expression = unwrapExpression(options)
      if (expression?.type !== 'ObjectExpression') {
        return
      }
      for (const property of expression.properties) {
        if (property.type !== 'Property' || staticPropertyKey(property) !== key) {
          continue
        }
        if (isZero(property.value)) {
          continue
        }
        context.report({
          node: property,
          message:
            'Do not retry tests: a test that passes on rerun is a flake. Diagnose the first-attempt failure and await the event the test depends on (a deferred promise, an Effect Deferred, or a Playwright locator), per the root AGENTS.md testing policy.'
        })
      }
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@playwright/test') {
          return
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            getPropertyName(specifier.imported) === 'defineConfig'
          ) {
            playwrightConfigs.add(specifier.local.name)
          }
        }
      },
      CallExpression(node) {
        const callee = unwrapExpression(node.callee)
        if (callee?.type === 'Identifier' && playwrightConfigs.has(callee.name)) {
          inspect(node.arguments[0], 'retries')
          return
        }
        if (isMemberOf(callee, 'vi', 'setConfig')) {
          inspect(node.arguments[0], 'retry')
          return
        }
        if (!isTestDeclaration(node)) {
          return
        }
        inspect(node.arguments[1], 'retry')
        inspect(node.arguments[2], 'retry')
      },
      Property(node) {
        if (staticPropertyKey(node) === 'test') {
          inspect(node.value, 'retry')
        }
      }
    }
  }
})

function isZero(node: ESTree.Node): boolean {
  const expression = unwrapExpression(node)
  return expression?.type === 'Literal' && expression.value === 0
}
