import { defineRule } from '@oxlint/plugins'
import { getPropertyName } from '../internal/ast.ts'

/**
 * Catches `die`, `dieMessage`, `orDie` and `orDieWith`. Each one moves a failure
 * out of the typed error channel and into a defect, so callers lose the very
 * thing Effect's error channel is for.
 *
 * The starter's capabilities all fail with tagged errors, and every route and UI
 * surface matches on them, so a defect here would surface as an opaque 500.
 * Test files are exempted through `.oxlintrc.json` overrides, not by this rule.
 *
 * Ported from oxlint-plugin-executor/rules/no-effect-escape-hatch.js (MIT).
 */

const ESCAPE_HATCHES = new Set(['die', 'dieMessage', 'orDie', 'orDieWith'])

export default defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Effect die and orDie escape hatches.' }
  },
  create(context) {
    return {
      MemberExpression(node) {
        const property = getPropertyName(node.property)
        if (property === undefined || !ESCAPE_HATCHES.has(property)) return

        context.report({
          node,
          message: `Avoid ${property}. It turns a typed failure into a defect, so fail with a tagged error and let the caller match on it.`
        })
      }
    }
  }
})
