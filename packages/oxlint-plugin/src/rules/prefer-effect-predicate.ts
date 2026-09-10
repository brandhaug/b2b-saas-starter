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

/**
 * Which pair to name depends on the operator: `value !== null` is
 * `isNotNull`, `value === null` is `isNull`. Naming the inverted helper sent
 * anyone who followed the message to the wrong one.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const MESSAGES = {
  presence:
    'Avoid hand-written nullish predicates. Use Predicate.isNotNull or Predicate.isNotNullable from effect, which also narrow the filtered type.',
  absence:
    'Avoid hand-written nullish predicates. Use Predicate.isNull or Predicate.isNullable from effect, which also narrow the filtered type.'
} as const

type NullishDirection = keyof typeof MESSAGES

const COMPARISON_DIRECTIONS = new Map<string, NullishDirection>([
  ['!==', 'presence'],
  ['!=', 'presence'],
  ['===', 'absence'],
  ['==', 'absence']
])

function isNullishLiteral(node: ESTree.Node | undefined): boolean {
  if (node === undefined) {
    return false
  }
  if (node.type === 'Literal' && node.value === null) {
    return true
  }
  return isIdentifier(node, 'undefined')
}

function nullishComparisonDirection(
  node: ESTree.Node | null | undefined,
  parameterName: string
): NullishDirection | undefined {
  const expression = unwrapExpression(node)
  if (expression?.type !== 'BinaryExpression') {
    return undefined
  }
  const direction = COMPARISON_DIRECTIONS.get(expression.operator)
  if (direction === undefined) {
    return undefined
  }

  const left = unwrapExpression(expression.left)
  const right = unwrapExpression(expression.right)
  if (isIdentifier(left, parameterName) && isNullishLiteral(right)) {
    return direction
  }
  if (isIdentifier(right, parameterName) && isNullishLiteral(left)) {
    return direction
  }
  return undefined
}

function singleParameterName(
  params: ReadonlyArray<ESTree.ParamPattern>
): string | undefined {
  if (params.length !== 1) {
    return undefined
  }
  const [parameter] = params
  if (parameter?.type !== 'Identifier') {
    return undefined
  }
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
  if (expression === undefined) {
    return undefined
  }
  if (expression.type !== 'BlockStatement') {
    return expression
  }
  if (expression.body.length !== 1) {
    return undefined
  }

  const [statement] = expression.body
  if (statement?.type !== 'ReturnStatement') {
    return undefined
  }
  if (statement.argument === null) {
    return undefined
  }
  return statement.argument
}

function nullishPredicateDirection(
  node: ESTree.ArrowFunctionExpression | ESTree.Function
): NullishDirection | undefined {
  const parameterName = singleParameterName(node.params)
  if (parameterName === undefined) {
    return undefined
  }
  return nullishComparisonDirection(predicateResult(node.body), parameterName)
}

function isFilterCall(node: ESTree.CallExpression): boolean {
  const callee = unwrapExpression(node.callee)
  if (callee?.type !== 'MemberExpression') {
    return false
  }
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
        if (node.source.value === 'effect') {
          hasEffectImport = true
        }
      },
      VariableDeclarator(node) {
        if (!hasEffectImport) {
          return
        }

        const init = unwrapExpression(node.init)
        if (init?.type !== 'ArrowFunctionExpression') {
          return
        }
        const direction = nullishPredicateDirection(init)
        if (direction === undefined) {
          return
        }

        context.report({ node: init, message: MESSAGES[direction] })
      },
      FunctionDeclaration(node) {
        if (!hasEffectImport) {
          return
        }
        const direction = nullishPredicateDirection(node)
        if (direction === undefined) {
          return
        }

        context.report({ node, message: MESSAGES[direction] })
      },
      CallExpression(node) {
        if (!hasEffectImport || !isFilterCall(node)) {
          return
        }

        const [firstArgument] = node.arguments
        const predicate = unwrapExpression(firstArgument)
        if (predicate === undefined) {
          return
        }
        if (
          predicate.type !== 'ArrowFunctionExpression' &&
          predicate.type !== 'FunctionExpression'
        ) {
          return
        }
        const direction = nullishPredicateDirection(predicate)
        if (direction === undefined) {
          return
        }

        context.report({ node: predicate, message: MESSAGES[direction] })
      }
    }
  }
})
