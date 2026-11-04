import { defineRule, type ESTree } from 'vite-plus/lint/plugins'
import {
  getPropertyName,
  getStringValue,
  parentOf,
  unwrapExpression
} from '../internal/ast.ts'

export default defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Bind a yielded service before invoking its methods inside an Effect generator.'
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const member = unwrapExpression(node.callee)
        if (member?.type !== 'MemberExpression') {
          return
        }
        const receiver = unwrapExpression(member.object)
        if (receiver?.type !== 'YieldExpression' || !receiver.delegate) {
          return
        }
        if (!isServiceReference(receiver.argument)) {
          return
        }
        const namespace = generatorNamespace(node)
        if (namespace === undefined) {
          return
        }
        // Resolve the reference, not its spelling: a parameter named Effect can
        // shadow the import and implement an unrelated generator protocol.
        const reference = context.sourceCode
          .getScope(namespace)
          .references.find((candidate) => candidate.identifier === namespace)
        const definition = reference?.resolved?.defs[0]
        if (definition?.type !== 'ImportBinding' || !isEffectImport(definition.node)) {
          return
        }
        context.report({
          node: receiver,
          message:
            'Bind the yielded receiver before calling its method: const service = yield* Service; then yield* service.method(...). Keep acquisition inside the same branch and generator.'
        })
      }
    }
  }
})

// Calls can yield arrays, maps or other values whose methods need no service
// binding. Restrict the check to the repo's capitalized service-class spelling.
function isServiceReference(node: ESTree.Node | null): boolean {
  const reference = unwrapExpression(node)
  if (reference?.type === 'Identifier') {
    return /^[A-Z]/u.test(reference.name)
  }
  if (
    reference?.type !== 'MemberExpression' ||
    unwrapExpression(reference.object)?.type !== 'Identifier'
  ) {
    return false
  }
  let name = getPropertyName(reference.property)
  if (reference.computed) {
    name = getStringValue(reference.property)
  }
  return name !== undefined && /^[A-Z]/u.test(name)
}

function isEffectImport(node: ESTree.Node): boolean {
  const declaration = parentOf(node)
  if (declaration?.type !== 'ImportDeclaration' || declaration.importKind === 'type') {
    return false
  }
  if (node.type === 'ImportNamespaceSpecifier') {
    return declaration.source.value === 'effect/Effect'
  }
  return (
    node.type === 'ImportSpecifier' &&
    node.importKind !== 'type' &&
    declaration.source.value === 'effect' &&
    getPropertyName(node.imported) === 'Effect'
  )
}

// Only direct callbacks establish the generator protocol. Stop at the nearest
// function so a native generator nested inside Effect.gen remains untouched.
function generatorNamespace(
  node: ESTree.Node
): Extract<ESTree.Node, { readonly type: 'Identifier' }> | undefined {
  let current = parentOf(node)
  while (current !== undefined) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      return undefined
    }
    if (current.type === 'FunctionExpression') {
      if (!current.generator || current.async) {
        return undefined
      }
      const call = parentOf(current)
      if (call?.type !== 'CallExpression' || !call.arguments.includes(current)) {
        return undefined
      }
      let callee = unwrapExpression(call.callee)
      const curried = callee?.type === 'CallExpression'
      if (callee?.type === 'CallExpression') {
        callee = unwrapExpression(callee.callee)
      }
      if (callee?.type !== 'MemberExpression') {
        return undefined
      }
      let method = getPropertyName(callee.property)
      if (callee.computed) {
        method = getStringValue(callee.property)
      }
      if (
        method !== 'fn' &&
        (curried || (method !== 'gen' && method !== 'fnUntraced'))
      ) {
        return undefined
      }
      const namespace = unwrapExpression(callee.object)
      if (namespace?.type === 'Identifier') {
        return namespace
      }
      return undefined
    }
    current = parentOf(current)
  }
  return undefined
}
