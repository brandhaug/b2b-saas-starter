// oxlint-disable-next-line effect/noNodeBuiltinImport -- the guard reads the quoted sources off the repository tree; a colocated test runs in Node, not in a Worker
import { readFileSync } from 'node:fs'
// oxlint-disable-next-line effect/noNodeBuiltinImport -- same: resolving a repository path is a Node-side job, and the test never ships to the Worker
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { QUOTED_SNIPPETS } from './request-trace-snippets'

/**
 * Each panel in the request trace captions itself with a repository path, so
 * the landing page claims the code it shows is the code that runs. This test
 * reads those files: a renamed helper, a moved guard, or a hand-written
 * snippet nobody ever wrote in the source fails here instead of shipping.
 */
const repoRoot = resolve(import.meta.dirname, '../../../../..')

function sourceOf(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('request trace snippets', () => {
  it.each(QUOTED_SNIPPETS)('quotes $path verbatim', (snippet) => {
    const source = sourceOf(snippet.path)
    const quoted = snippet.code
      .split('\n')
      .map((line) => line.trim())
      // `…` is the section's elision mark; every other line is a claim.
      .filter((line) => line !== '' && !line.includes('…'))
    for (const line of quoted) {
      expect(source).toContain(line)
    }
  })
})
