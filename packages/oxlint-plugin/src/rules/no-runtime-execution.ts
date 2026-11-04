import { defineRule, type ESTree } from 'vite-plus/lint/plugins'
import {
  getPropertyName,
  getStringValue,
  parentOf,
  unwrapExpression
} from '../internal/ast.ts'

// Promise runners are covered by effect/noRunPromise. This rule covers the
// remaining execution APIs, including references that can escape as callbacks.
const runners = new Set([
  'runSync',
  'runSyncExit',
  'runSyncWith',
  'runSyncExitWith',
  'runFork',
  'runForkWith',
  'runCallback',
  'runCallbackWith'
])

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep Effect execution and ManagedRuntime construction at application boundaries.'
    }
  },
  create(context) {
    function imported(node: ESTree.Node): string | undefined {
      if (node.type !== 'Identifier') {
        return undefined
      }
      const reference = context.sourceCode
        .getScope(node)
        .references.find((candidate) => candidate.identifier === node)
      const definition = reference?.resolved?.defs[0]
      if (definition?.type !== 'ImportBinding') {
        return undefined
      }
      return importPath(definition.node)
    }
    return {
      ImportSpecifier(node) {
        const path = importPath(node)
        if (path !== undefined && isExecution(path)) {
          report(node)
        }
      },
      MemberExpression(node) {
        const object = unwrapExpression(node.object)
        if (object === undefined) {
          return
        }
        let path = imported(object)
        if (object.type === 'MemberExpression') {
          const root = unwrapExpression(object.object)
          if (root !== undefined && imported(root) === 'effect') {
            path = `effect/${memberName(object)}`
          }
        }
        if (path !== undefined && isExecution(`${path}/${memberName(node)}`)) {
          report(node)
          return
        }
        const method = memberName(node)
        if (method !== undefined && runners.has(method) && isRuntimeReceiver(object)) {
          report(node)
        }
      }
    }
    function report(node: ESTree.Node) {
      context.report({
        node,
        message:
          'Return an Effect and compose it in the caller context. Execute it only in a named application/framework adapter exempted in lint.config.ts; ManagedRuntime resources need an application lifetime owner.'
      })
    }
  }
})

// Match the same explicit receiver naming convention as effect/noRunPromise.
// This is syntax, not proof of a ManagedRuntime type.
function isRuntimeReceiver(node: ESTree.Node): boolean {
  let name: string | undefined
  if (node.type === 'Identifier') {
    name = node.name
  } else if (node.type === 'MemberExpression') {
    name = memberName(node)
  }
  return name !== undefined && (name === 'runtime' || name.endsWith('Runtime'))
}

function memberName(node: ESTree.MemberExpression): string | undefined {
  if (node.computed) {
    return getStringValue(node.property)
  }
  return getPropertyName(node.property)
}

function importPath(node: ESTree.Node): string | undefined {
  const declaration = parentOf(node)
  if (declaration?.type !== 'ImportDeclaration' || declaration.importKind === 'type') {
    return undefined
  }
  const source = declaration.source.value
  if (node.type === 'ImportNamespaceSpecifier') {
    return source
  }
  if (node.type === 'ImportSpecifier' && node.importKind !== 'type') {
    return `${source}/${getPropertyName(node.imported)}`
  }
  return undefined
}

function isExecution(path: string): boolean {
  if (path === 'effect/ManagedRuntime/make') {
    return true
  }
  return (
    path.startsWith('effect/Effect/') &&
    runners.has(path.slice('effect/Effect/'.length))
  )
}
