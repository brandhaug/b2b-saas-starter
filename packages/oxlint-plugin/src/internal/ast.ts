import { type ESTree } from '@oxlint/plugins'

/**
 * The AST plumbing the starter rules share, and nothing else.
 *
 * Rules load inside oxlint's plugin runtime, so `@oxlint/plugins` stays the only
 * dependency: no `effect/Option` here. "Not found" is `undefined`, which is what
 * the oxc ESTree nodes already use for absent children.
 */

type ExpressionWrapper =
  | ESTree.ChainExpression
  | ESTree.ParenthesizedExpression
  | ESTree.TSNonNullExpression
  | ESTree.TSAsExpression
  | ESTree.TSTypeAssertion

function isExpressionWrapper(node: ESTree.Node): node is ExpressionWrapper {
  return (
    node.type === 'ChainExpression' ||
    node.type === 'ParenthesizedExpression' ||
    node.type === 'TSNonNullExpression' ||
    node.type === 'TSAsExpression' ||
    node.type === 'TSTypeAssertion'
  )
}

/**
 * Strips the wrappers that add no runtime meaning, so a rule can match on the
 * expression a reader sees: `(x)`, `x!`, `x as T`, `<T>x`, `x?.y`.
 */
export function unwrapExpression(
  node: ESTree.Node | null | undefined
): ESTree.Node | undefined {
  let current = node
  while (current !== null && current !== undefined && isExpressionWrapper(current)) {
    current = current.expression
  }
  if (current === null) return undefined
  return current
}

/**
 * Name of a property key or member access: `x.name`, `x.#name`, `x['name']`.
 */
export function getPropertyName(
  node: ESTree.Node | null | undefined
): string | undefined {
  if (node === null || node === undefined) return undefined
  if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') return node.name
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- oxc gives every literal `type: 'Literal'`, so `typeof value` is the only narrowing to a string literal that does not need an assertion
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  return undefined
}

/** Value of a string literal, after unwrapping. */
export function getStringValue(
  node: ESTree.Node | null | undefined
): string | undefined {
  const expression = unwrapExpression(node)
  if (expression === undefined) return undefined
  if (expression.type !== 'Literal') return undefined
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see getPropertyName above
  if (typeof expression.value !== 'string') return undefined
  return expression.value
}

/** True when `node` is an identifier, optionally one with the given name. */
export function isIdentifier(
  node: ESTree.Node | null | undefined,
  name?: string
): boolean {
  if (node === null || node === undefined) return false
  if (node.type !== 'Identifier') return false
  if (name === undefined) return true
  return node.name === name
}

/**
 * The parent link, or `undefined` at the root.
 *
 * `@oxlint/plugins` types `node.parent` as always present, but oxlint passes `null`
 * for the `Program` node, so a rule that walks upward and reads `.type` off it
 * throws at runtime. The type is wrong, which also means `no-unnecessary-condition`
 * calls the guard redundant and will happily delete it again. Annotating the value
 * here is what keeps that from happening, so walk upward through this helper rather
 * than reading `.parent` directly.
 */
export function parentOf(node: ESTree.Node): ESTree.Node | undefined {
  const parent: ESTree.Node | null | undefined = node.parent
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- the declared type says non-nullable and is wrong; oxlint passes null at the Program root, so removing this guard makes every upward walk throw
  if (parent === null || parent === undefined) return undefined
  return parent
}
