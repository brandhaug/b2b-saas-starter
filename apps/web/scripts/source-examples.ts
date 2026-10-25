import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

type Node = {
  type: string
  value?: string
  meta?: string | null
  url?: string
  children?: Array<Node>
  position?: { start: { line: number } }
}

/** Build-only remark plugin. The fence body is the exact, contiguous selection. */
export function remarkSourceExamples({ root }: { root: string }) {
  const repository = realpathSync(root)
  return (tree: Node, file: { path?: string }) => {
    function visit(parent: Node) {
      if (!parent.children) {
        return
      }
      parent.children = parent.children.flatMap((node): Array<Node> => {
        visit(node)
        if (node.type !== 'code' || !/(?:^|\s)source(?:=|\s|$)/.test(node.meta ?? '')) {
          return [node]
        }
        const metadata = node.meta ?? ''
        const match = /^source="([^"]+)"$/.exec(metadata)
        const path = match?.[1] ?? metadata
        function fail(reason: string): never {
          throw new Error(
            `${file.path ?? '<mdx>'}:${node.position?.start.line ?? 1}: source ${path}: ${reason}`
          )
        }
        if (!match) {
          fail('expected source="repo/path" as the only fence metadata')
        }
        if (
          isAbsolute(path) ||
          path.includes('\\') ||
          path.split('/').some((part) => part === '..' || part === '.' || part === '')
        ) {
          fail('expected a repository-relative path without traversal')
        }
        let resolved: string
        let content: string
        try {
          resolved = realpathSync(resolve(repository, path))
        } catch {
          return fail('cannot read source file')
        }
        const local = relative(repository, resolved)
        if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
          fail('source resolves outside repository')
        }
        try {
          content = readFileSync(resolved, 'utf8')
        } catch {
          return fail('cannot read source file')
        }
        const excerpt = node.value ?? ''
        if (!excerpt.trim()) {
          fail('empty excerpt')
        }
        const lines = content.replaceAll('\r\n', '\n').split('\n')
        const selection = excerpt.split('\n')
        const matches = lines.flatMap((_, index) =>
          selection.every((line, offset) => lines[index + offset] === line)
            ? [index]
            : []
        )
        const first = matches[0]
        if (matches.length !== 1 || first === undefined) {
          return fail(
            `${matches.length === 0 ? 'no exact match' : 'ambiguous excerpt'} for ${selection.length} lines starting ${JSON.stringify(selection[0])}; copy a unique contiguous excerpt from the current source`
          )
        }
        const start = first + 1
        const end = start + selection.length - 1
        const url = `https://github.com/brandhaug/b2b-saas-starter/blob/master/${path.split('/').map(encodeURIComponent).join('/')}#L${start}-L${end}`
        node.meta = null
        return [
          node,
          {
            type: 'paragraph',
            children: [
              {
                type: 'link',
                url,
                children: [
                  { type: 'text', value: `Source: ${path}, lines ${start}–${end}` }
                ]
              }
            ]
          }
        ]
      })
    }
    visit(tree)
  }
}
