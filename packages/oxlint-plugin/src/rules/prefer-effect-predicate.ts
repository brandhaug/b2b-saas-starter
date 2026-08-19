import { defineRule, type ESTree } from '@oxlint/plugins'
import { getPropertyName, isIdentifier, unwrapExpression } from '../internal/ast.ts'

/**
 * Catches hand-written nullish predicates: `(value) => value !== null`, the same
 * shape written as a function declaration, and the inline form inside
 * `.filter(...)`. Effect ships these as `Predicate.isNotNull` and
 * `Predicate.isNotNullable`, which narrow the element type of a filtered array
 * where the hand-written arrow does not.
 *
 * Only files that import `effect` are checked, so plain modules keep their local
 * comparisons.
 *
 * Ported from oxlint-plugin-executor/rules/prefer-effect-predicate.js (MIT).
 */

const MESSAGE =
  'Avoid hand-written nullish predicates. Use Predicate.isNotNull or Predicate.isNotNullable from effect, which also narrow the filtered type.'

const COMPARISON_OPERATORS = new Set(['!==', '!=', '===', '=='])

function isNullishLiteral(node: ESTree.Node | undefined): boolean {
  if (node === undefined) return false
  if (node.type === 'Literal' && node.value === null) return true
  return isIdentifier(node, 'undefined')
}

function isNullishComparison(
  node: ESTree.Node | null | undefined,
  parameterName: string
): boolean {
  const expression = unwrapExpression(node)
  if (expression?.type !== 'BinaryExpression') return false
  if (!COMPARISON_OPERATORS.has(expression.operator)) return false

  const left = unwrapExpression(expression.left)
  const right = unwrapExpression(expression.right)
  if (isIdentifier(left, parameterName) && isNullishLiteral(right)) return true
  return isIdentifier(right, parameterName) && isNullishLiteral(left)
}

function singleParameterName(
  params: readonly ESTree.ParamPattern[]
): string | undefined {
  if (params.length !== 1) return undefined
  const [parameter] = params
  if (parameter?.type !== 'Identifier') return undefined
  return parameter.name
}

/**
 * The expression a predicate resolves to. Unlike the upstream rule this also
 * reads a single `return` out of a block body, because this repo's `func-style`
 * setting means most predicates are function declarations.
 */
function predicateResult(
  body: ESTree.Node | null | undefined
): ESTree.Node | undefined {
  const expression = unwrapExpression(body)
  if (expression === undefined) return undefined
  if (expression.type !== 'BlockStatement') return expression
  if (expression.body.length !== 1) return undefined

  const [statement] = expression.body
  if (statement?.type !== 'ReturnStatement') return undefined
  if (statement.argument === null) return undefined
  return statement.argument
}

function isNullishPredicate(node: ESTree.ArrowFunctionExpression | ESTree.Function) {
  const parameterName = singleParameterName(node.params)
  if (parameterName === undefined) return false
  return isNullishComparison(predicateResult(node.body), parameterName)
}

function isFilterCall(node: ESTree.CallExpression): boolean {
  const callee = unwrapExpression(node.callee)
  if (callee?.type !== 'MemberExpression') return false
  return getPropertyName(callee.property) === 'filter'
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Prefer effect Predicate helpers over hand-written null checks.'
    }
  },
  create(context) {
    let hasEffectImport = false

    return {
      ImportDeclaration(node) {
        if (node.source.value === 'effect') hasEffectImport = true
      },
      VariableDeclarator(node) {
        if (!hasEffectImport) return

        const init = unwrapExpression(node.init)
        if (init?.type !== 'ArrowFunctionExpression') return
        if (!isNullishPredicate(init)) return

        context.report({ node: init, message: MESSAGE })
      },
      FunctionDeclaration(node) {
        if (!hasEffectImport) return
        if (!isNullishPredicate(node)) return

        context.report({ node, message: MESSAGE })
      },
      CallExpression(node) {
        if (!hasEffectImport || !isFilterCall(node)) return

        const [firstArgument] = node.arguments
        const predicate = unwrapExpression(firstArgument)
        if (predicate === undefined) return
        if (
          predicate.type !== 'ArrowFunctionExpression' &&
          predicate.type !== 'FunctionExpression'
        ) {
          return
        }
        if (!isNullishPredicate(predicate)) return

        context.report({ node: predicate, message: MESSAGE })
      }
    }
  }
})
