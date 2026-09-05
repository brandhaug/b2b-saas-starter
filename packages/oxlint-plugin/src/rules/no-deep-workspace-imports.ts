import { defineRule, type ESTree } from '@oxlint/plugins'
import { getStringValue } from '../internal/ast.ts'

/**
 * Catches imports that reach through a workspace package's `"./src/*"` source
 * tree instead of its curated `exports` subpaths, e.g.
 * `@b2b-saas-starter/db/src/schema.ts` instead of `@b2b-saas-starter/db/schema`.
 *
 * The curated subpaths are the packages' real interfaces: they are what keeps
 * the browser-safe-client rule and the testing-only module out of application
 * code. The wildcard was removed so the packages' export maps refuse these at
 * runtime; this rule surfaces the violation at lint time with the concrete
 * replacement named.
 *
 * Only specifiers under the workspace scope are checked. Intra-package
 * relative imports and third-party `/src/` paths are not this rule's business.
 */

const WORKSPACE_SCOPE = '@b2b-saas-starter/'

function isDeepSourceImport(source: string): boolean {
  return (
    source.startsWith(WORKSPACE_SCOPE) &&
    (source.includes('/src/') || source.endsWith('/src'))
  )
}

/** Import sources worth reporting on, from every syntax form that carries one. */
function deepWorkspaceSources(node: ESTree.Node): ReadonlyArray<string> {
  if (
    node.type !== 'ImportDeclaration' &&
    node.type !== 'ImportExpression' &&
    node.type !== 'ExportNamedDeclaration' &&
    node.type !== 'ExportAllDeclaration'
  ) {
    return []
  }
  const source = getStringValue(node.source)
  if (source === undefined || !isDeepSourceImport(source)) {
    return []
  }
  return [source]
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow imports through a workspace package src/ tree instead of its curated exports subpaths.'
    }
  },
  create(context) {
    return {
      'ImportDeclaration, ImportExpression, ExportNamedDeclaration, ExportAllDeclaration':
        (node: ESTree.Node) => {
          for (const source of deepWorkspaceSources(node)) {
            context.report({
              node,
              message: `Import '${source}' through a src/ path. Use the package's curated exports subpath instead (e.g. '@b2b-saas-starter/db/schema', or add the subpath to the package's exports map if it is missing).`
            })
          }
        }
    }
  }
})
