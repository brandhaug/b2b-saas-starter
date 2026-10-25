import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { articleMarkdown } from './agent-markdown.mjs'

const { values } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    'web-root': { type: 'string', default: resolve(import.meta.dirname, '..') }
  }
})
const root = resolve(values['web-root'])
const content = join(root, 'content/docs')
const publicRoot = join(root, 'public')

function files(directory, prefix = '') {
  if (lstatSync(directory).isSymbolicLink()) {
    throw new Error(`Symlink refused: ${directory}`)
  }
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      const relative = `${prefix}${entry.name}`
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlink refused: ${path}`)
      }
      return entry.isDirectory() ? files(path, `${relative}/`) : [relative]
    })
    .toSorted((a, b) => a.localeCompare(b, 'en'))
}

const sourceFiles = files(content).filter((path) => path.endsWith('.mdx'))
if (sourceFiles.length === 0) {
  throw new Error('No public MDX articles found')
}
const ids = new Set(
  sourceFiles.map((path) => {
    if (!/^[a-z0-9-]+\/[a-z0-9-]+\.mdx$/u.test(path)) {
      throw new Error(`Unsupported public article path: ${path}`)
    }
    return path.slice(0, -4)
  })
)
const outputs = new Map()
const articles = sourceFiles.map((path) => {
  const id = path.slice(0, -4)
  const sourcePath = `apps/web/content/docs/${path}`
  const article = articleMarkdown(
    readFileSync(join(content, path), 'utf8'),
    sourcePath,
    id,
    ids
  )
  const markdownUrl = `/agent-docs/${id}.md`
  outputs.set(markdownUrl.slice(1), article.markdown)
  return {
    id: `docs/${id}`,
    title: article.title,
    description: article.description,
    canonicalUrl: article.canonicalUrl,
    markdownUrl,
    sourcePath,
    digest: `sha256:${createHash('sha256').update(article.markdown).digest('hex')}`
  }
})

const intro =
  '# B2B SaaS Starter\n\nPublic documentation generated from the MDX collection. Article bodies are English; /nb navigation does not translate them. URLs are origin-relative.\n'
const tasks = [
  ['Run locally', 'getting-started/quickstart'],
  ['Add a business feature', 'getting-started/first-business-feature'],
  ['Understand the architecture', 'architecture/overview'],
  ['Configure optional providers', 'getting-started/optional-providers'],
  ['Deploy to Cloudflare', 'getting-started/cloudflare-deployment'],
  ['Call the REST API', 'capability-interfaces/rest-api'],
  ['Connect an MCP client', 'capability-interfaces/mcp-server'],
  ['Check workspace permissions', 'governance/workspace-roles']
]
const taskLinks = tasks
  .map(([task, id]) => {
    const article = articles.find((entry) => entry.id === `docs/${id}`)
    if (!article) {
      throw new Error(`Missing task entry article: ${id}`)
    }
    return `- [${task}](${article.markdownUrl}): ${article.description}`
  })
  .join('\n')
outputs.set(
  'llms.txt',
  `${intro}\n## Start with a task\n\n${taskLinks}\n\n## Complete collection\n\n- [Article index](/agent-docs/index.json): stable IDs, titles, canonical URLs, source paths and SHA-256 digests of the exact Markdown bytes.\n- [All articles](/llms-full.txt): full English article content.\n`
)
outputs.set(
  'llms-full.txt',
  `${intro}\n${articles.map((article) => `---\n\n${outputs.get(article.markdownUrl.slice(1))}`).join('\n')}`
)
outputs.set(
  'agent-docs/index.json',
  `${JSON.stringify({ language: 'en', articles }, null, 2)}\n`
)

// Parse and validate the entire collection before touching generated files.
const existing = existsSync(join(publicRoot, 'agent-docs'))
  ? files(join(publicRoot, 'agent-docs')).map((path) => `agent-docs/${path}`)
  : []
const stale = existing.filter((path) => !outputs.has(path))
const changed = [...outputs].filter(([path, value]) => {
  const target = join(publicRoot, path)
  if (!existsSync(target)) {
    return true
  }
  if (lstatSync(target).isSymbolicLink()) {
    throw new Error(`Symlink refused: ${target}`)
  }
  return readFileSync(target, 'utf8') !== value
})
if (values.check) {
  if (stale.length || changed.length) {
    throw new Error(
      `Agent export drift; run pnpm -C apps/web docs:generate:\n${[...stale, ...changed.map(([path]) => path)].join('\n')}`
    )
  }
} else {
  for (const path of stale) {
    rmSync(join(publicRoot, path))
  }
  for (const [path, value] of changed) {
    const target = join(publicRoot, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, value)
  }
}
console.log(
  `Agent exports ${values.check ? 'verified' : 'generated'}: ${articles.length} English articles`
)
