import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve(import.meta.dirname, 'generate-agent-exports.mjs')
const web = resolve(import.meta.dirname, '..')

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'agent-exports-'))
  try {
    cpSync(join(web, 'content/docs'), join(root, 'content/docs'), { recursive: true })
    mkdirSync(join(root, 'public'), { recursive: true })
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function generate(root, ...args) {
  return spawnSync(process.execPath, [script, '--web-root', root, ...args], {
    encoding: 'utf8'
  })
}

await test('public collection generates deterministic linked Markdown with verifiable digests', () => {
  fixture((root) => {
    mkdirSync(join(root, 'internal'))
    writeFileSync(join(root, 'internal/AGENTS.md'), 'PRIVATE_SENTINEL')
    const source = join(root, 'content/docs/getting-started/quickstart.mdx')
    writeFileSync(
      source,
      `${readFileSync(source, 'utf8')}\n[Title](/docs/architecture/overview "/docs/architecture/overview")\n\n[Reference][architecture]\n\n[architecture]: /docs/architecture/overview#workers\n`
    )
    const result = generate(root)
    assert.equal(result.status, 0, result.stderr)
    const index = JSON.parse(
      readFileSync(join(root, 'public/agent-docs/index.json'), 'utf8')
    )
    assert.equal(index.language, 'en')
    assert.ok(index.articles.length >= 28)
    for (const article of index.articles) {
      const markdown = readFileSync(join(root, 'public', article.markdownUrl), 'utf8')
      assert.equal(
        article.digest,
        `sha256:${createHash('sha256').update(markdown).digest('hex')}`
      )
      assert.ok(article.canonicalUrl.startsWith('/en/docs/'))
      assert.ok(article.sourcePath.startsWith('apps/web/content/docs/'))
      assert.ok(markdown.startsWith(`# ${article.title}\n`))
      assert.ok(!markdown.includes('PRIVATE_SENTINEL'))
    }
    const quickstart = readFileSync(
      join(root, 'public/agent-docs/getting-started/quickstart.md'),
      'utf8'
    )
    assert.ok(quickstart.includes('```bash\nvp install'))
    assert.ok(quickstart.includes('](/agent-docs/getting-started/seed-workspace.md)'))
    assert.ok(
      quickstart.includes(
        '[Title](/agent-docs/architecture/overview.md "/docs/architecture/overview")'
      )
    )
    assert.ok(
      quickstart.includes(
        '[architecture]: /agent-docs/architecture/overview.md#workers'
      )
    )
    const architecture = readFileSync(
      join(root, 'public/agent-docs/architecture/overview.md'),
      'utf8'
    )
    assert.ok(architecture.includes('Browser → web (TanStack Start)'))
    assert.ok(!architecture.includes('<ArchitectureSchematic'))
    assert.equal(generate(root, '--check').status, 0)
    assert.equal(generate(root).status, 0)
    assert.equal(generate(root, '--check').status, 0)
    writeFileSync(join(root, 'public/agent-docs/stale.md'), 'obsolete')
    assert.notEqual(generate(root, '--check').status, 0)
    assert.equal(generate(root).status, 0)
    writeFileSync(join(root, 'public/llms.txt'), 'drift')
    assert.notEqual(generate(root, '--check').status, 0)
    assert.equal(generate(root).status, 0)
    rmSync(join(root, 'public/llms-full.txt'))
    assert.notEqual(generate(root, '--check').status, 0)
  })
})

await test('unsupported content and broken doc links fail with source diagnostics before writes', () => {
  for (const material of [
    '<Unknown />',
    '<ArchitectureSchematic activeNodes={["web"]} />',
    '{1 + 1}',
    'export const hidden = "lost"',
    '[Missing](/docs/architecture/missing)'
  ]) {
    fixture((root) => {
      const source = join(root, 'content/docs/architecture/overview.mdx')
      writeFileSync(source, `${readFileSync(source, 'utf8')}\n${material}\n`)
      const result = generate(root)
      assert.notEqual(result.status, 0, material)
      assert.match(result.stderr, /architecture\/overview\.mdx/u)
    })
  }
})

await test('symlinked public sources are refused', () => {
  fixture((root) => {
    const source = join(root, 'content/docs/architecture/overview.mdx')
    rmSync(source)
    symlinkSync(join(web, 'content/docs/architecture/overview.mdx'), source)
    assert.notEqual(generate(root).status, 0)
  })
})

await test('checked-in public exports match the collection', () => {
  execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })
})
