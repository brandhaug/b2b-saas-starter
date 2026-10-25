import { createProcessor } from '@mdx-js/mdx'
import { load, JSON_SCHEMA } from 'js-yaml'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'

const parser = createProcessor({ remarkPlugins: [remarkFrontmatter, remarkGfm] })

// Plain representation of the only component admitted by mdx-components.ts.
const architecture = `Architecture paths:

- Browser → web (TanStack Start) → packages/capabilities
- HTTP client → api (REST + MCP) → packages/capabilities
- MCP client → api (REST + MCP) → packages/capabilities
- Queue jobs → background (queue consumer) → packages/capabilities
- packages/capabilities → D1, Durable Objects, Queues, Email`

/** Parse without evaluating MDX, then serialize the admitted Markdown tree. */
export function articleMarkdown(source, sourcePath, id, articleIds) {
  function fail(node, message) {
    throw new Error(`${sourcePath}:${node.position?.start.line ?? 1}: ${message}`)
  }
  const tree = parser.parse({ value: source, path: sourcePath })
  const frontmatter = tree.children.at(0)
  if (frontmatter?.type !== 'yaml') {
    fail(tree, 'Expected YAML frontmatter')
  }
  const metadata = load(frontmatter.value, {
    schema: JSON_SCHEMA,
    filename: sourcePath
  })
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    typeof metadata.title !== 'string' ||
    !metadata.title.trim() ||
    /[\r\n]/u.test(metadata.title) ||
    typeof metadata.description !== 'string' ||
    !metadata.description.trim() ||
    /[\r\n]/u.test(metadata.description) ||
    (metadata.category !== undefined && metadata.category !== id.split('/')[0])
  ) {
    fail(frontmatter, 'Expected title, description and matching category when supplied')
  }
  function convert(node) {
    if (node.type === 'yaml') {
      if (node !== frontmatter) {
        fail(node, 'Only leading frontmatter is supported')
      }
      return []
    }
    if (node.type.startsWith('mdx') || node.type === 'html') {
      if (
        node.type === 'mdxJsxFlowElement' &&
        node.name === 'ArchitectureSchematic' &&
        node.attributes.length === 0 &&
        node.children.length === 0
      ) {
        return parser.parse(architecture).children
      }
      fail(
        node,
        `Unsupported MDX material: ${node.name ?? node.type}; add an explicit plain representation`
      )
    }
    if (['link', 'image', 'definition'].includes(node.type)) {
      const url = node.url
      const doc = /^\/(?:en\/|nb\/)?docs\/([^?#]+)(.*)$/u.exec(url)
      let target = url
      if (doc) {
        const targetId = doc[1].replace(/\/$/u, '')
        if (!articleIds.has(targetId)) {
          fail(node, `Unknown public article: ${url}`)
        }
        target = `/agent-docs/${targetId}.md${doc[2]}`
      } else if (url === '/docs' || url === '/en/docs' || url === '/nb/docs') {
        target = '/llms.txt'
      } else if (!/^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(url)) {
        fail(node, `Relative URL needs an explicit public destination: ${url}`)
      }
      node.url = target
    }
    if (node.children) {
      node.children = node.children.flatMap(convert)
    }
    return [node]
  }
  convert(tree)
  const body = toMarkdown(tree, { extensions: [gfmToMarkdown()], fences: true })
  const canonicalUrl = `/en/docs/${id}`
  const markdown = `# ${metadata.title}\n\n${metadata.description}\n\nCanonical: ${canonicalUrl}\nSource: ${sourcePath}\nLanguage: en\n\n${body.trim()}\n`
  return {
    title: metadata.title,
    description: metadata.description,
    canonicalUrl,
    markdown
  }
}
