import { defineRule } from '@oxlint/plugins'
import { getPropertyName, isIdentifier } from '../internal/ast.ts'

/**
 * Catches Effect v2 and v3 combinators that Effect v4 renamed. They fail as a
 * missing export at runtime rather than at the call site, and the compiler error
 * does not say what replaced them, so the rule names the replacement.
 *
 * Ported from oxlint-plugin-executor/rules/no-unsupported-effect-api.js (MIT).
 */

const REPLACEMENTS = new Map([
  [
    'async',
    'Effect.async does not exist in Effect v4. Use Effect.callback to adapt a callback API.'
  ],
  [
    'zipRight',
    'Effect.zipRight does not exist in Effect v4. Use Effect.andThen, or sequence the steps in Effect.gen.'
  ],
  [
    'timeoutFail',
    'Effect.timeoutFail does not exist in Effect v4. Use Effect.timeoutOrElse and fail with a tagged error in the fallback.'
  ]
])

export default defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Effect APIs that Effect v4 renamed.' }
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (!isIdentifier(node.object, 'Effect')) return

        const property = getPropertyName(node.property)
        if (property === undefined) return

        const message = REPLACEMENTS.get(property)
        if (message === undefined) return

        context.report({ node, message })
      }
    }
  }
})
