/* oxlint-disable effect/noNodeBuiltinImport -- This module is imported only by Vite configuration, never by the application. */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compile } from '@mdx-js/mdx'
import { load } from 'js-yaml'
import { Schema } from 'effect'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import { rehypePrettyCode } from 'rehype-pretty-code'
import { type Plugin } from 'vite'
import { remarkSourceExamples } from '../../../scripts/source-examples'
import { DocMeta, type Heading } from './contracts'
import { DOC_CATEGORY_ORDER, isDocCategory } from '../../lib/doc-categories'

type Node = {
  type: string
  tagName?: string
  name?: string
  value?: string
  properties?: Record<
    string,
    string | number | boolean | ReadonlyArray<string | number> | null | undefined
  >
  children?: Array<Node>
}
const decodeMeta = Schema.decodeUnknownSync(DocMeta)
function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
function text(node: Node): string {
  return node.type === 'text'
    ? (node.value ?? '')
    : (node.children ?? []).map(text).join('')
}
function html(node: Node): string {
  if (node.type === 'text') {
    return escape(node.value ?? '')
  }
  if (node.type === 'root') {
    return (node.children ?? []).map(html).join('')
  }
  if (node.type === 'mdxJsxFlowElement' && node.name === 'ArchitectureSchematic') {
    return '<!--starter-architecture-->'
  }
  assert(
    node.type === 'element' && node.tagName,
    `Unsupported executable documentation node: ${node.type}`
  )
  const attributes = Object.entries(node.properties ?? {})
    .flatMap(([key, value]) => {
      assert(
        !/^on/i.test(key),
        `Event attributes are not permitted in documentation: ${key}`
      )
      if (value === null || value === undefined || value === false) {
        return []
      }
      let name = key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
      if (key === 'className') {
        name = 'class'
      }
      if (key === 'htmlFor') {
        name = 'for'
      }
      if (value === true) {
        return [` ${name}`]
      }
      const encoded = Array.isArray(value) ? value.join(' ') : String(value)
      if (key === 'href' || key === 'src') {
        assert(
          !/^\s*(javascript|data|vbscript):/i.test(encoded),
          'Unsupported documentation URL'
        )
      }
      return [` ${name}="${escape(encoded)}"`]
    })
    .join('')
  return `<${node.tagName}${attributes}>${['br', 'hr', 'img', 'input', 'wbr'].includes(node.tagName) ? '' : `${(node.children ?? []).map(html).join('')}</${node.tagName}>`}`
}

/** Compile checked excerpts and static documentation without a React runtime. */
export async function compileDocument(raw: string, path: string, root: string) {
  let body = ''
  const headings: Array<typeof Heading.Type> = []
  function capture() {
    return (tree: Node) => {
      function visit(node: Node) {
        if ((node.tagName === 'h2' || node.tagName === 'h3') && node.properties?.id) {
          headings.push({
            id: String(node.properties.id),
            text: text(node),
            level: node.tagName === 'h2' ? 2 : 3
          })
        }
        for (const child of node.children ?? []) {
          visit(child)
        }
      }
      visit(tree)
      body = html(tree)
    }
  }
  await compile(
    { value: raw, path },
    {
      remarkPlugins: [remarkFrontmatter, remarkGfm, [remarkSourceExamples, { root }]],
      rehypePlugins: [
        rehypeSlug,
        [
          rehypePrettyCode,
          { theme: { dark: 'catppuccin-mocha', light: 'catppuccin-mocha' } }
        ],
        capture
      ]
    }
  )
  return { html: body, headings }
}

/** Complete static content compilation, including the existing source-excerpt validation. */
export function foldkitDocs(): Plugin {
  const root = resolve(import.meta.dirname, '../../..')
  const content = resolve(root, 'content/docs')
  const id = 'virtual:foldkit-docs'
  return {
    name: 'foldkit-docs',
    resolveId(source) {
      return source === id ? `\0${id}` : null
    },
    async load(source) {
      if (source !== `\0${id}`) {
        return null
      }
      const files = readdirSync(content, {
        recursive: true,
        withFileTypes: true
      }).filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
      // oxlint-disable-next-line effect/noNewPromise -- Vite's async loader compiles independent repository articles concurrently.
      const articles = await Promise.all(
        files.map(async (entry) => {
          const path = resolve(entry.parentPath, entry.name)
          this.addWatchFile(path)
          const raw = readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
          const category = path.slice(content.length + 1).split('/')[0]
          const slug = entry.name.slice(0, -4)
          const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1]
          assert(frontmatter, `Missing frontmatter: ${path}`)
          const meta = decodeMeta({ category, slug, frontmatter: load(frontmatter) })
          const document = await compileDocument(raw, path, resolve(root, '../..'))
          return { meta, html: document.html, headings: document.headings }
        })
      )
      articles.sort(
        (a, b) =>
          categoryOrder(a.meta.category) - categoryOrder(b.meta.category) ||
          (a.meta.frontmatter.order ?? Number.MAX_SAFE_INTEGER) -
            (b.meta.frontmatter.order ?? Number.MAX_SAFE_INTEGER)
      )
      return `export default ${JSON.stringify(articles).replaceAll('<', String.raw`\u003c`)}`
    }
  }
}

function categoryOrder(category: string): number {
  return isDocCategory(category)
    ? DOC_CATEGORY_ORDER.indexOf(category)
    : DOC_CATEGORY_ORDER.length
}
