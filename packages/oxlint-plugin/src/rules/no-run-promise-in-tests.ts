import { defineRule, type ESTree } from '@oxlint/plugins'
import { getPropertyName, isIdentifier, unwrapExpression } from '../internal/ast.ts'

/**
 * Catches `Effect.runPromise(...)` and `Effect.runPromiseExit(...)` inside test
 * files: a hand-started runtime that swaps the test's context for a bare one.
 * `it.effect` from `@effect/vitest` runs the same effect inside TestContext —
 * the Scope comes from the runner, typed errors fail the test through the
 * fiber, and interruption guarantees hold. A runPromise call quietly discards
 * all three, and its real clock hides the TestClock hazards (an `Effect.sleep`
 * never advancing; a `DateTime.now` reading wall time while the rest of the
 * suite reads epoch 0, standing expiry fixtures on their head).
 *
 * Deliberately only the promise runners: `runFork`/`runSync` have test uses a
 * blanket ban would misjudge. Path gating lives in the root `lint.config.ts`
 * test override — outside test files `Effect.runPromise` is the correct way to
 * bridge into callback and promise code. Genuine interop sites inside tests
 * (a runner port a non-Effect framework calls) keep an `oxlint-disable` with
 * the reason.
 *
 * The rule only fires when `Effect` is imported from `effect`, so another
 * object that happens to be named `Effect` stays quiet.
 */

const RUNNERS = new Set(['runPromise', 'runPromiseExit'])

/** Local names bound to the Effect namespace by an `import … from 'effect'`. */
function effectNamespaceNames(node: ESTree.ImportDeclaration): Array<string> {
  if (node.source.value !== 'effect') {
    return []
  }
  const names: Array<string> = []
  for (const specifier of node.specifiers) {
    if (specifier.type === 'ImportDefaultSpecifier') {
      continue
    }
    if (specifier.type === 'ImportNamespaceSpecifier') {
      names.push(specifier.local.name)
      continue
    }
    if (getPropertyName(specifier.imported) === 'Effect') {
      names.push(specifier.local.name)
    }
  }
  return names
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Effect.runPromise and Effect.runPromiseExit in test files; run the effect under it.effect or it.live from @effect/vitest instead.'
    }
  },
  create(context) {
    const namespaces = new Set<string>()

    return {
      ImportDeclaration(node) {
        for (const name of effectNamespaceNames(node)) {
          namespaces.add(name)
        }
      },
      CallExpression(node) {
        const callee = unwrapExpression(node.callee)
        if (callee?.type !== 'MemberExpression') {
          return
        }
        const object = unwrapExpression(callee.object)
        if (!isIdentifier(object) || !namespaces.has(object.name)) {
          return
        }
        const runner = getPropertyName(callee.property)
        if (runner === undefined || !RUNNERS.has(runner)) {
          return
        }
        context.report({
          node: callee,
          message: `Effect.${runner} starts a bare runtime inside a test: no TestContext Scope, no fiber-reported failures, and time reads leave the TestClock. Run the effect under it.effect (or it.live when the test needs real time) from '@effect/vitest'. A deliberate promise-interop boundary keeps this call with an oxlint-disable naming the port it bridges.`
        })
      }
    }
  }
})
