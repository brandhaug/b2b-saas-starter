import { defineRule, type ESTree } from 'vite-plus/lint/plugins'
import { getPropertyName, getStringValue, unwrapExpression } from '../internal/ast.ts'
import { isEffectImport } from '../internal/effect-import.ts'

export default defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Use stable named Effect operation boundaries or explain an untraced helper.'
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const member = unwrapExpression(node.callee)
        if (member?.type !== 'MemberExpression') {
          return
        }
        let method = getPropertyName(member.property)
        if (member.computed) {
          method = getStringValue(member.property)
        }
        if (method !== 'fn' && method !== 'fnUntraced') {
          return
        }
        const namespace = unwrapExpression(member.object)
        if (namespace?.type !== 'Identifier') {
          return
        }
        const reference = context.sourceCode
          .getScope(namespace)
          .references.find((candidate) => candidate.identifier === namespace)
        const definition = reference?.resolved?.defs[0]
        if (definition?.type !== 'ImportBinding' || !isEffectImport(definition.node)) {
          return
        }
        if (method === 'fn' && staticLabel(node.arguments[0])) {
          return
        }
        context.report({
          node,
          message:
            "Use Effect.fn('Service.operation') with a static label. For a deliberately untraced helper, use Effect.fnUntraced with a local lint suppression explaining the frequency or existing tracing boundary."
        })
      }
    }
  }
})

function staticLabel(node: ESTree.Node | undefined): boolean {
  const expression = unwrapExpression(node)
  if (expression?.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return (expression.quasis[0]?.value.cooked?.trim().length ?? 0) > 0
  }
  return (getStringValue(expression)?.trim().length ?? 0) > 0
}
