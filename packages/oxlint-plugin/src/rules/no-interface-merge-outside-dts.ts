import { defineRule } from '@oxlint/plugins'

/**
 * Reports an `interface` declared inside a `declare module` / `declare global` /
 * `declare namespace` block in a file that is not a `.d.ts`.
 *
 * This guards CLAUDE.md rule 7, and it exists because the failure is silent.
 * `@typescript-eslint/consistent-type-definitions` is set to `"type"` repo-wide and
 * is auto-fixable, the lint config only exempts `**\/*.d.ts`, and `pnpm run
 * check:fix` runs `vp lint --fix`. So an augmentation written in a `.ts` file gets
 * its `interface` rewritten to a `type` alias, which stops merging and starts
 * shadowing: the augmentation silently becomes a duplicate identifier instead of
 * extending the upstream declaration. This rule has no fixer, so it survives
 * `--fix` and leaves a visible error instead.
 */
export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow interface declarations inside module augmentation blocks outside .d.ts files.'
    }
  },
  create(context) {
    if (context.filename.endsWith('.d.ts')) {
      return {}
    }

    return {
      TSModuleDeclaration(node) {
        // A module declaration with no block body is `declare module 'x'` with no
        // members, or a nested `declare module a.b`, and merges nothing either way.
        if (node.body === null) {
          return
        }
        if (!('body' in node.body)) {
          return
        }

        for (const statement of node.body.body) {
          if (statement.type !== 'TSInterfaceDeclaration') {
            continue
          }
          context.report({
            node: statement,
            message:
              'Move this declaration merge into a .d.ts file. Here consistent-type-definitions rewrites the interface to a type alias, and pnpm run check:fix will apply it, turning the augmentation into a duplicate identifier.'
          })
        }
      }
    }
  }
})
