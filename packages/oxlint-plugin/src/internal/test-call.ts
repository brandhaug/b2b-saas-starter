import { type ESTree } from 'vite-plus/lint/plugins'
import { getPropertyName, parentOf, unwrapExpression } from './ast.ts'

/**
 * Test-runner call shapes shared by the test synchronization rules. Vitest,
 * `@effect/vitest` and Playwright all spell tests `test`/`it` and accept options
 * objects, and `layer(...)` hands its tester in as a callback parameter named
 * `it`, so the rules match the runner's names rather than resolving imports.
 */

const DECLARATIONS = new Set(['test', 'it', 'describe', 'suite'])
const BODIES = new Set([
  'test',
  'it',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll'
])
/** Members that build a test function rather than declare a test. */
const BUILDERS = new Set(['each', 'for', 'extend', 'scoped', 'override'])

/**
 * A call that declares a test or suite and so takes options: `it(...)`,
 * `it.effect(...)`, `describe.concurrent(...)`, `test.each(rows)(...)`. The
 * builder call `test.each(rows)` itself is not one.
 */
export function isTestDeclaration(call: ESTree.CallExpression): boolean {
  const callee = unwrapExpression(call.callee)
  if (callee === undefined || !DECLARATIONS.has(calleeRootName(callee) ?? '')) {
    return false
  }
  if (callee.type !== 'MemberExpression') {
    return true
  }
  return !BUILDERS.has(getPropertyName(callee.property) ?? '')
}

/** True when `fn` is passed as an argument to a test or lifecycle-hook call. */
export function isTestBody(fn: ESTree.Node): boolean {
  const call = parentOf(fn)
  if (call?.type !== 'CallExpression' || unwrapExpression(call.callee) === fn) {
    return false
  }
  return BODIES.has(calleeRootName(call.callee) ?? '')
}

/**
 * The identifier a callee chain starts from: `it`, `it.effect`,
 * `it.concurrent.skip`, `test.each([...])` and `` test.each`table` `` all give
 * the leftmost name.
 */
function calleeRootName(callee: ESTree.Node): string | undefined {
  let current = unwrapExpression(callee)
  while (current !== undefined) {
    if (current.type === 'MemberExpression') {
      current = unwrapExpression(current.object)
    } else if (current.type === 'CallExpression') {
      current = unwrapExpression(current.callee)
    } else if (current.type === 'TaggedTemplateExpression') {
      current = unwrapExpression(current.tag)
    } else {
      break
    }
  }
  if (current?.type !== 'Identifier') {
    return undefined
  }
  return current.name
}
