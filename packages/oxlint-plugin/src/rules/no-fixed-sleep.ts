import { defineRule, type ESTree } from 'vite-plus/lint/plugins'
import {
  getPropertyName,
  isIdentifier,
  isMemberOf,
  parentOf,
  soleBodyExpression,
  unwrapExpression
} from '../internal/ast.ts'
import { isTestBody } from '../internal/test-call.ts'

/**
 * Catches a fixed real-time delay awaited directly in a test or hook body:
 * `new Promise((resolve) => setTimeout(resolve, n))`, `setTimeout` from
 * `node:timers/promises`, and `scheduler.wait`. A sleep guesses how long real
 * work takes, so it passes on an idle machine and fails under CI load; awaiting
 * the operation or a signal its handler resolves proves the ordering instead.
 *
 * A file that calls `vi.useFakeTimers()` stays quiet, since its timers are
 * advanced by hand. Sleeps inside helpers or nested functions are left to
 * review. Adapted from `@interfere/landmines` (see `third-party-licenses.md`),
 * without its allowlist.
 */

const TIMER_MODULES = new Set(['node:timers/promises', 'timers/promises'])

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow awaiting a fixed real-time delay in a test or hook body.'
    }
  },
  create(context) {
    const timers = new Set<string>()
    const sleeps: Array<ESTree.AwaitExpression> = []
    let fakeTimers = false

    function isSleep(node: ESTree.Node | undefined): boolean {
      if (node?.type === 'NewExpression') {
        return isIdentifier(node.callee, 'Promise') && resolvesAfterTimeout(node)
      }
      if (node?.type !== 'CallExpression') {
        return false
      }
      const callee = unwrapExpression(node.callee)
      return (
        (callee?.type === 'Identifier' && timers.has(callee.name)) ||
        isMemberOf(callee, 'scheduler', 'wait')
      )
    }

    return {
      ImportDeclaration(node) {
        if (!TIMER_MODULES.has(node.source.value)) {
          return
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            getPropertyName(specifier.imported) === 'setTimeout'
          ) {
            timers.add(specifier.local.name)
          }
        }
      },
      CallExpression(node) {
        if (isMemberOf(node.callee, 'vi', 'useFakeTimers')) {
          fakeTimers = true
        }
      },
      AwaitExpression(node) {
        if (isSleep(unwrapExpression(node.argument)) && inTestBody(node)) {
          sleeps.push(node)
        }
      },
      'Program:exit'() {
        if (fakeTimers) {
          return
        }
        for (const node of sleeps) {
          context.report({
            node,
            message:
              'Replace this fixed sleep with a signal: await the operation itself, or a deferred promise its handler resolves (like apps/web/src/test/deferred.ts, or Deferred in Effect code). To move time, call vi.useFakeTimers() and advance it, or run the effect under TestClock.'
          })
        }
      }
    }
  }
})

/** True when the nearest enclosing function is a test or hook callback. */
function inTestBody(node: ESTree.Node): boolean {
  let current = parentOf(node)
  while (
    current !== undefined &&
    current.type !== 'ArrowFunctionExpression' &&
    current.type !== 'FunctionExpression' &&
    current.type !== 'FunctionDeclaration'
  ) {
    current = parentOf(current)
  }
  return current !== undefined && isTestBody(current)
}

/** `new Promise((resolve) => setTimeout(resolve, n))` and its block/wrapped forms. */
function resolvesAfterTimeout(node: ESTree.NewExpression): boolean {
  const [executor] = node.arguments
  if (
    executor?.type !== 'ArrowFunctionExpression' &&
    executor?.type !== 'FunctionExpression'
  ) {
    return false
  }
  const [resolve] = executor.params
  if (resolve?.type !== 'Identifier') {
    return false
  }
  const call = soleBodyExpression(executor)
  if (call?.type !== 'CallExpression' || !isSetTimeout(call.callee)) {
    return false
  }
  const handler = unwrapExpression(call.arguments[0])
  if (handler?.type === 'Identifier') {
    return handler.name === resolve.name
  }
  const body = soleBodyExpression(handler)
  return body?.type === 'CallExpression' && isIdentifier(body.callee, resolve.name)
}

function isSetTimeout(node: ESTree.Node): boolean {
  return (
    isIdentifier(unwrapExpression(node), 'setTimeout') ||
    isMemberOf(node, 'globalThis', 'setTimeout') ||
    isMemberOf(node, 'window', 'setTimeout')
  )
}
