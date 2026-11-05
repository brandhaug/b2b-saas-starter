import { defineRule, type ESTree } from 'vite-plus/lint/plugins'
import { getPropertyName, getStringValue, unwrapExpression } from '../internal/ast.ts'

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep browser test deadlines and retries in the runner configuration.'
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const path: Array<string> = []
        let target = unwrapExpression(node.callee)
        while (target?.type === 'MemberExpression') {
          const name = memberName(target)
          if (name === undefined) {
            return
          }
          path.unshift(name)
          target = unwrapExpression(target.object)
        }
        if (target?.type !== 'Identifier') {
          return
        }
        const reference = context.sourceCode
          .getScope(target)
          .references.find((candidate) => candidate.identifier === target)
        const definition = reference?.resolved?.defs[0]
        if (
          definition?.type !== 'ImportBinding' ||
          definition.parent?.type !== 'ImportDeclaration' ||
          definition.parent.source.value !== '@playwright/test'
        ) {
          return
        }
        if (definition.node.type === 'ImportNamespaceSpecifier') {
          if (path.shift() !== 'test') {
            return
          }
        } else if (
          definition.node.type !== 'ImportSpecifier' ||
          getPropertyName(definition.node.imported) !== 'test'
        ) {
          return
        }
        const method = path.join('.')
        if (
          method !== 'setTimeout' &&
          method !== 'slow' &&
          !(method === 'describe.configure' && hasInflation(node.arguments[0]))
        ) {
          return
        }
        context.report({
          node,
          message:
            'Use the existing deadlines and retry policy in apps/web/playwright.config.ts. Diagnose first-attempt evidence and wait for observable readiness instead of overriding a test timeout, marking it slow or adding retries.'
        })
      }
    }
  }
})

function memberName(node: ESTree.MemberExpression): string | undefined {
  if (node.computed) {
    return getStringValue(node.property)
  }
  return getPropertyName(node.property)
}

function hasInflation(node: ESTree.Node | undefined): boolean {
  const options = unwrapExpression(node)
  if (options?.type !== 'ObjectExpression') {
    return false
  }
  return options.properties.some((property) => {
    if (property.type !== 'Property') {
      return false
    }
    let name = getPropertyName(property.key)
    if (property.computed) {
      name = getStringValue(property.key)
    }
    return name === 'timeout' || name === 'retries'
  })
}
