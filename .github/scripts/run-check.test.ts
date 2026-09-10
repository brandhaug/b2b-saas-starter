import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { onTestFinished, test } from 'vite-plus/test'

test('e2e retries the failing suite once, keeps its evidence, then fails', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ci-retry-'))
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }))
  const bin = join(folder, 'bin')
  mkdirSync(bin)
  // Playwright clears its output directories when the next attempt starts, so
  // the fake suite does the same to prove the wrapper copies them out first.
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/usr/bin/env node
const fs = require('node:fs')
for (const directory of ['test-results', 'playwright-report']) {
  const path = 'apps/web/' + directory
  fs.rmSync(path, {recursive: true, force: true})
  fs.mkdirSync(path, {recursive: true})
  fs.writeFileSync(path + '/evidence.txt', 'failure trace')
}
fs.appendFileSync('arguments.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n')
process.exit(1)
`,
    { mode: 0o755 }
  )
  writeFileSync(join(bin, 'pkill'), '#!/usr/bin/env node\nprocess.exit(1)\n', {
    mode: 0o755
  })
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./run-check.ts', import.meta.url)), 'e2e', '--shard=2/2'],
    {
      cwd: folder,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
      encoding: 'utf8'
    }
  )
  assert.equal(result.status, 1, result.stderr)
  assert.deepEqual(
    readFileSync(join(folder, 'arguments.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
    [
      ['run', 'test:e2e', '--shard=2/2'],
      ['run', 'test:e2e', '--shard=2/2']
    ]
  )
  assert.equal(
    readFileSync(join(folder, 'apps/web/test-results-attempt-1/evidence.txt'), 'utf8'),
    'failure trace'
  )
})
