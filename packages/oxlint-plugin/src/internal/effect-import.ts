import { type ESTree } from 'vite-plus/lint/plugins'
import { getPropertyName, parentOf } from './ast.ts'

/** Check the resolved definition, so aliases work and shadowed imports do not. */
export function isEffectImport(node: ESTree.Node): boolean {
  return isEffectModuleImport(node, 'Effect')
}

/**
 * True for a value import of the named `effect` module — `{ Layer } from
 * 'effect'` or `* as L from 'effect/Layer'` — or, with no name, of any of them.
 */
export function isEffectModuleImport(node: ESTree.Node, moduleName?: string): boolean {
  const declaration = parentOf(node)
  if (declaration?.type !== 'ImportDeclaration' || declaration.importKind === 'type') {
    return false
  }
  const source = declaration.source.value
  if (node.type === 'ImportNamespaceSpecifier') {
    if (moduleName === undefined) {
      return source === 'effect' || source.startsWith('effect/')
    }
    return source === `effect/${moduleName}`
  }
  return (
    node.type === 'ImportSpecifier' &&
    node.importKind !== 'type' &&
    source === 'effect' &&
    (moduleName === undefined || getPropertyName(node.imported) === moduleName)
  )
}
