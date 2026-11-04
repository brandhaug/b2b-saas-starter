import { type ESTree } from 'vite-plus/lint/plugins'
import { getPropertyName, parentOf } from './ast.ts'

/** Check the resolved definition, so aliases work and shadowed imports do not. */
export function isEffectImport(node: ESTree.Node): boolean {
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
