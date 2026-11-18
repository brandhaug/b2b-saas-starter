import { defineRule, type ESTree } from 'vite-plus/lint/plugins'
import {
  getPropertyName,
  isIdentifier,
  isMemberOf,
  parentOf,
  soleBodyExpression,
  unwrapExpression
} from '../internal/ast.ts'

/**
 * Catches `vi.waitFor` and `expect.poll` callbacks that poll a request
 * recorder or spy: `.mock` state, a member's `.length`/`.size`, or a recorder
 * matcher. The poll races a deadline against work that already has an event,
 * so it fails under CI load and a longer timeout only hides that. The fix is a
 * deferred promise the recording handler resolves.
 *
 * The `.length`/`.size` heuristic also matches non-recorder collections; give
 * those a reasoned suppression. DOM queries made through calls and React
 * `.current` refs stay quiet. Testing Library's `waitFor` and multi-statement
 * callbacks are left to review. Adapted from `@interfere/landmines` (see
 * `third-party-licenses.md`), without its allowlist.
 */

const RECORDER_MATCHER =
  /^(?:toHaveBeenCalled|toHaveBeenCalledOnce|toHaveBeenCalledTimes|toHaveBeenCalledWith|toHaveBeenCalledExactlyOnceWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toHaveReturned|toHaveReturnedTimes|toHaveReturnedWith|toHaveLastReturnedWith|toHaveNthReturnedWith|toHaveResolved|toHaveResolvedTimes|toHaveResolvedWith|toHaveLastResolvedWith|toHaveNthResolvedWith|toHaveLength)$/u

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow vi.waitFor and expect.poll on request recorders and spy state; await a signal instead.'
    }
  },
  create(context) {
    function report(node: ESTree.CallExpression): void {
      context.report({
        node,
        message:
          "Await a signal instead of polling a recorder or spy: resolve a deferred promise from the handler or callback that records it (like apps/web/src/test/deferred.ts, or Deferred in Effect code) and await it, or await the operation's own completion."
      })
    }

    return {
      CallExpression(node) {
        const value = soleBodyExpression(node.arguments[0])
        if (value === undefined) {
          return
        }
        // expect.poll asserts on the polled value outside the callback, so only a
        // trailing .toHaveLength reads recorder state; vi.waitFor asserts inside it.
        if (isMemberOf(node.callee, 'expect', 'poll')) {
          if (readsRecorder(value) || polledLength(node, value)) {
            report(node)
          }
        } else if (isMemberOf(node.callee, 'vi', 'waitFor')) {
          if (readsRecorder(value) || assertsRecorder(value)) {
            report(node)
          }
        }
      }
    }
  }
})

/**
 * `a.b.c` as `['a', 'b', 'c']`. `undefined` for anything but a plain access
 * path, and for React refs (`.current`), which are rendered state.
 */
function accessPath(node: ESTree.Node | undefined): ReadonlyArray<string> | undefined {
  const path = rawAccessPath(node)
  if (path?.includes('current')) {
    return undefined
  }
  return path
}

function rawAccessPath(
  node: ESTree.Node | undefined
): ReadonlyArray<string> | undefined {
  const expression = unwrapExpression(node)
  if (expression?.type === 'Identifier') {
    return [expression.name]
  }
  if (expression?.type !== 'MemberExpression') {
    return undefined
  }
  const object = rawAccessPath(expression.object)
  if (object === undefined) {
    return undefined
  }
  if (expression.computed) {
    return [...object, '[]']
  }
  return [...object, getPropertyName(expression.property) ?? '[]']
}

/** A path into a spy's `.mock` state, or a member's `.length`/`.size`. */
function readsRecorder(node: ESTree.Node): boolean {
  const path = accessPath(node)
  if (path === undefined) {
    return false
  }
  const last = path.at(-1)
  return (
    path.includes('mock') || (path.length > 1 && (last === 'length' || last === 'size'))
  )
}

/** `expect(recorder)[.not].toHaveBeenCalled…(…)` and friends. */
function assertsRecorder(node: ESTree.Node): boolean {
  if (node.type !== 'CallExpression') {
    return false
  }
  const callee = unwrapExpression(node.callee)
  if (callee?.type !== 'MemberExpression') {
    return false
  }
  const matcher = getPropertyName(callee.property) ?? ''
  let subject = unwrapExpression(callee.object)
  if (
    subject?.type === 'MemberExpression' &&
    getPropertyName(subject.property) === 'not'
  ) {
    subject = unwrapExpression(subject.object)
  }
  if (subject?.type !== 'CallExpression' || !isIdentifier(subject.callee, 'expect')) {
    return false
  }
  const [target] = subject.arguments
  if (target === undefined || target.type === 'SpreadElement') {
    return false
  }
  return (
    readsRecorder(target) ||
    (accessPath(target) !== undefined && RECORDER_MATCHER.test(matcher))
  )
}

/** `expect.poll(() => recorder).toHaveLength(n)`. */
function polledLength(poll: ESTree.CallExpression, value: ESTree.Node): boolean {
  const parent = parentOf(poll)
  return (
    parent?.type === 'MemberExpression' &&
    getPropertyName(parent.property) === 'toHaveLength' &&
    accessPath(value) !== undefined
  )
}
