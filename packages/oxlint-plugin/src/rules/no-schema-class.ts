import { defineRule, type ESTree } from '@oxlint/plugins'
import { getPropertyName, isIdentifier, unwrapExpression } from '../internal/ast.ts'

/**
 * Catches `Schema.Class` and `Schema.TaggedClass`, including the
 * `class X extends Schema.Class<X>('X')({ ... })` form. Effect v4 encodes a
 * class schema through an `instanceof` check, which a plain object fails at
 * runtime even though TypeScript's structural typing accepts it. Class and
 * struct therefore look interchangeable at compile time and are not.
 *
 * The starter passes decoded values across worker, queue and HTTP boundaries as
 * plain objects, so struct schemas are the shape that survives. `ErrorClass` and
 * `TaggedErrorClass` stay allowed: they are how Effect models typed errors.
 *
 * Ported from oxlint-plugin-executor/rules/no-schema-class.js (MIT).
 */

function isSchemaClassCall(node: ESTree.Node | null | undefined): boolean {
  const expression = unwrapExpression(node)
  if (expression?.type !== 'CallExpression') return false

  // `Schema.TaggedClass<X>()('X', fields)` nests calls, so walk down to the
  // member access the whole chain hangs off.
  let callee = unwrapExpression(expression.callee)
  while (callee?.type === 'CallExpression') {
    callee = unwrapExpression(callee.callee)
  }

  if (callee?.type !== 'MemberExpression') return false
  if (!isIdentifier(unwrapExpression(callee.object), 'Schema')) return false

  const method = getPropertyName(callee.property)
  return method === 'Class' || method === 'TaggedClass'
}

/** True for the inner calls of a curried chain, which the outer call reports for. */
function isCalleeOfEnclosingCall(node: ESTree.CallExpression): boolean {
  const { parent } = node
  if (parent.type !== 'CallExpression') return false
  return unwrapExpression(parent.callee) === node
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Schema.Class and Schema.TaggedClass.' }
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isCalleeOfEnclosingCall(node)) return
        if (!isSchemaClassCall(node)) return

        context.report({
          node,
          message:
            'Avoid Schema.Class and Schema.TaggedClass. Encoding them runs an instanceof check that a plain object fails, so use Schema.Struct or Schema.TaggedStruct with Schema.is for runtime checks.'
        })
      }
    }
  }
})
