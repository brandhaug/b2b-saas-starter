import { defineRule } from '@oxlint/plugins'
import { getStringValue } from '../internal/ast.ts'

/**
 * Catches a raw hex color literal. DESIGN.md allows exactly one home for raw
 * values — `apps/web/src/index.css`, where the OKLch token definitions live —
 * and everywhere else the semantic token is the interface (`var(--primary)`,
 * `bg-card`, the Tailwind theme map). A hex in TypeScript forks the palette:
 * it skips the single-scheme contrast check and drifts from the token it
 * copies.
 *
 * Whole-string literals only (after trimming): class strings and `style`
 * values carry colors as complete strings, and a substring probe would flag
 * prose that happens to contain a `#`. The exemption for
 * `apps/web/src/routes/__root.tsx` lives in the root lint config, not here —
 * see the plugin's invariants.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw hex color literals; colors are semantic tokens defined in apps/web/src/index.css.'
    }
  },
  create(context) {
    return {
      Literal: (node) => {
        const value = getStringValue(node)
        if (value === undefined) {
          return
        }
        const trimmed = value.trim()
        if (HEX_COLOR.test(trimmed)) {
          context.report({
            node,
            message: `Raw color '${trimmed}'. Use the semantic token instead — e.g. 'var(--primary)' or the Tailwind token class — and keep the raw value in apps/web/src/index.css, the one file allowed to define colors.`
          })
        }
      }
    }
  }
})
