import { defineRule } from '@oxlint/plugins'

/**
 * Reports a `.d.ts` file whose augmentation kind does not match the file's
 * module-ness. TypeScript reads the same syntax two different ways depending on
 * whether the file has a top-level import or export:
 *
 * - `declare module 'specifier'` augments the real module only inside a module. In a
 *   global script it declares a brand new ambient module instead, so the intended
 *   members never reach the real one.
 * - `declare global` and `declare namespace X` reach the global scope only from a
 *   global script. Inside a module they apply to that module, so the global type
 *   never appears. `apps/web/src/worker-env.d.ts` documents this and uses inline
 *   `import()` types for exactly this reason.
 *
 * Both mistakes typecheck. Nothing errors, the augmented member is simply absent,
 * and the symptom shows up far away as a missing property. This rule turns the
 * silent version into a lint error, which is the load-bearing half of CLAUDE.md
 * rule 7 ("give that file a top-level import so it stays a module").
 */

const MODULE_MARKERS = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'ExportDefaultDeclaration',
  'TSImportEqualsDeclaration',
  'TSExportAssignment'
])

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a .d.ts augmentation to match its file module context: module augmentation needs a top-level import, global and namespace declarations need none.'
    }
  },
  create(context) {
    if (!context.filename.endsWith('.d.ts')) {
      return {}
    }

    let isModule = false

    return {
      Program(node) {
        isModule = node.body.some((statement) => MODULE_MARKERS.has(statement.type))
      },
      TSModuleDeclaration(node) {
        // A string id means `declare module 'specifier'`, which is augmentation. An
        // identifier id is `declare namespace X`, and `declare global` sets `global`.
        const augmentsModule = node.id.type === 'Literal'

        if (augmentsModule && !isModule) {
          context.report({
            node,
            message:
              'This file has no top-level import or export, so it is a global script and `declare module` declares a new ambient module instead of augmenting the real one. Add a top-level import to make the file a module.'
          })
          return
        }

        if (!augmentsModule && isModule) {
          context.report({
            node,
            message:
              'This file has a top-level import or export, so it is a module and this global declaration never reaches the global scope. Drop the top-level import and use inline `import()` types instead, as `worker-env.d.ts` does.'
          })
        }
      }
    }
  }
})
