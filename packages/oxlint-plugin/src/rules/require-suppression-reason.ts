import { defineRule } from 'vite-plus/lint/plugins'

const DIRECTIVE = /^(?:oxlint|eslint)-disable(?:-next-line|-line)?\b/u

export default defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Require a local explanation for lint suppressions.' }
  },
  create(context) {
    return {
      Program() {
        const comments = context.sourceCode.getAllComments()
        for (const [index, comment] of comments.entries()) {
          const text = clean(comment.value)
          if (!DIRECTIVE.test(text)) {
            continue
          }
          const reason = text.split('--').slice(1).join('--')
          if (explained(reason)) {
            continue
          }
          let justified = false
          for (const direction of [-1, 1]) {
            let previous = comment
            for (
              let cursor = index + direction;
              cursor >= 0 && cursor < comments.length;
              cursor += direction
            ) {
              const adjacent = comments[cursor]
              if (adjacent === undefined) {
                break
              }
              const start = Math.min(previous.range[1], adjacent.range[1])
              const end = Math.max(previous.range[0], adjacent.range[0])
              const gap = context.sourceCode.text.slice(start, end)
              if (!/^\s*$/u.test(gap) || gap.split('\n').length > 2) {
                break
              }
              const prose = clean(adjacent.value)
              if (/^(?:(?:oxlint|eslint)-enable\b|@ts-)/u.test(prose)) {
                break
              }
              if (!DIRECTIVE.test(prose)) {
                justified = explained(prose)
                break
              }
              if (explained(prose.split('--').slice(1).join('--'))) {
                justified = true
                break
              }
              previous = adjacent
            }
            if (justified) {
              break
            }
          }
          if (!justified) {
            context.report({
              loc: comment.loc,
              message:
                'Explain this suppression with `-- reason` or adjacent prose naming the constraint. Keep unused-suppression checks enabled in lint.config.ts.'
            })
          }
        }
      }
    }
  }
})

function clean(text: string): string {
  return text.replaceAll(/^\s*\*\s?/gmu, '').trim()
}

function explained(reason: string): boolean {
  return (
    reason.trim().length >= 10 && (reason.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 2
  )
}
