import { defineRule, type ESTree } from '@oxlint/plugins'
import { getStringValue } from '../internal/ast.ts'

/**
 * Catches a Tailwind `dark:` variant in a class string. DESIGN.md fixes the
 * scheme: Catppuccin Mocha, everywhere, always — `<html>` carries a hardcoded
 * `dark` class and no second scheme exists to branch on, so a `dark:` variant
 * is dead code at best and an unreviewed second theme at worst.
 *
 * Checked on string literals and template-literal text (where class strings
 * live), so prose mentioning "dark:" in JSX text or comments is not reported.
 * The replacement is the semantic token the variant would have swapped.
 */

function classStringText(node: ESTree.Node): string | undefined {
  const literal = getStringValue(node)
  if (literal !== undefined) {
    return literal
  }
  if (node.type === 'TemplateElement') {
    return node.value.cooked ?? undefined
  }
  return undefined
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Tailwind dark: variants; the app has exactly one scheme.'
    }
  },
  create(context) {
    return {
      'Literal, TemplateElement': (node: ESTree.Node) => {
        const text = classStringText(node)
        if (text?.includes('dark:') ?? false) {
          context.report({
            node,
            message:
              "Remove the 'dark:' variant — the app ships one scheme (Catppuccin Mocha, always dark; see DESIGN.md). Use the semantic token the variant would have swapped, e.g. 'bg-background' instead of 'dark:bg-background'."
          })
        }
      }
    }
  }
})
