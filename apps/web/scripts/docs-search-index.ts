/* oxlint-disable effect/noNodeBuiltinImport -- Vite's build-time index runs at the Node platform boundary. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createProcessor } from '@mdx-js/mdx'
import { load } from 'js-yaml'
import { Schema } from 'effect'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import { type Plugin } from 'vite'
import { type DocsSearchArticle } from '../src/lib/docs-search'
import { isDocCategory } from '../src/lib/doc-categories'
import { GITHUB_URL } from '../src/lib/github-url'

type TextNode = {
  readonly type: string
  readonly value?: string
  readonly children?: ReadonlyArray<TextNode>
}

const decodeMetadata = Schema.decodeUnknownSync(
  Schema.Struct({ title: Schema.NonEmptyString, description: Schema.NonEmptyString })
)

// Index prose and inline code, never executable MDX, JSX attributes or fenced examples.
function prose(node: TextNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value ?? ''
  }
  if (
    ['yaml', 'code', 'mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression'].includes(
      node.type
    )
  ) {
    return ''
  }
  return (node.children ?? []).map(prose).join(' ')
}

function buildIndex(root: string): ReadonlyArray<DocsSearchArticle> {
  const processor = createProcessor({ remarkPlugins: [remarkFrontmatter, remarkGfm] })
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .toSorted()
    .map((file) => {
      const relative = file.slice(root.length + 1)
      const [category, filename, extra] = relative.split('/')
      assert(
        category && filename && !extra && isDocCategory(category),
        `Unsupported public docs path: ${relative}`
      )
      const slug = filename.slice(0, -4)
      assert(/^[a-z0-9-]+$/.test(slug), `Unsupported docs slug: ${slug}`)
      const raw = readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
      const tree = processor.parse(raw)
      const frontmatter = tree.children.find((node) => node.type === 'yaml')
      const meta = decodeMetadata(load(frontmatter?.value ?? ''))
      return {
        id: `${category}/${slug}`,
        category,
        slug,
        route: `/docs/${category}/${slug}`,
        title: meta.title,
        excerpt: meta.description.slice(0, 240),
        text: prose(tree).replaceAll(/\s+/g, ' ').trim(),
        source: `${GITHUB_URL}/blob/master/apps/web/content/docs/${relative}`,
        digest: `sha256:${createHash('sha256').update(raw).digest('hex')}`
      }
    })
}

/** A build-only parser; the virtual module contains JSON records and no MDX imports. */
export function docsSearchIndex(): Plugin {
  const root = resolve(import.meta.dirname, '../content/docs')
  const id = 'virtual:docs-search'
  return {
    name: 'public-docs-search-index',
    resolveId(source) {
      return source === id ? `\0${id}` : null
    },
    load(source) {
      if (source !== `\0${id}`) {
        return null
      }
      this.addWatchFile(root)
      const json = JSON.stringify(buildIndex(root))
      assert(
        Buffer.byteLength(json) <= 512_000,
        'Public docs search index exceeds 512 KB; revisit the index budget'
      )
      return `export default ${json}`
    },
    handleHotUpdate({ file, server }) {
      if (file.startsWith(`${root}/`) && file.endsWith('.mdx')) {
        server.moduleGraph.invalidateAll()
        server.ws.send({ type: 'full-reload' })
        return []
      }
    }
  }
}
