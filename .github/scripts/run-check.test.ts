import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { runCheck } from './run-check.ts'

await test('e2e preserves failure artifacts and clears stale workers before retrying', async () => {
  const events: Array<string> = []
  let attempts = 0
  const result = await runCheck('e2e', {
    run(command, args) {
      events.push([command, ...args].join(' '))
      if (command === 'pnpm') {
        attempts += 1
        return attempts === 2 ? 0 : 1
      }
      return 1 // No stale processes is a valid pkill outcome.
    },
    preserve: (attempt) => {
      events.push(`preserve ${attempt}`)
    },
    pause: () => {
      throw new Error('E2E retries do not pause')
    },
    warn: () => {}
  })
  assert.equal(result, 0)
  assert.deepEqual(events, [
    'pnpm run test:e2e',
    'preserve 1',
    'pkill -f vite dev',
    'pkill -f workerd',
    'pnpm run test:e2e'
  ])
})

await test('audit exhausts three attempts with two pauses and reports failure', async () => {
  let attempts = 0
  let pauses = 0
  const result = await runCheck('audit', {
    run(command, args) {
      assert.equal(command, 'pnpm')
      assert.deepEqual(args, ['audit', '--audit-level=high'])
      attempts += 1
      return 1
    },
    preserve: () => {
      throw new Error('Audit does not touch Playwright output')
    },
    pause: () => {
      pauses += 1
      return Promise.resolve()
    },
    warn: () => {}
  })
  assert.equal(result, 1)
  assert.equal(attempts, 3)
  assert.equal(pauses, 2)
})

await test('a successful first attempt does not retry or clean up', async () => {
  function unexpected(): never {
    throw new Error('Unexpected retry')
  }
  assert.equal(
    await runCheck('e2e', {
      run: () => 0,
      preserve: unexpected,
      pause: unexpected,
      warn: unexpected
    }),
    0
  )
})

await test('CLI retains first-attempt artifacts after Playwright clears its output', (context) => {
  const folder = mkdtempSync(join(tmpdir(), 'ci-retry-'))
  context.after(() => rmSync(folder, { recursive: true, force: true }))
  const bin = join(folder, 'bin')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/usr/bin/env node
const fs = require('node:fs')
const second = fs.existsSync('attempted')
for (const directory of ['test-results', 'playwright-report']) {
  const path = 'apps/web/' + directory
  fs.rmSync(path, {recursive: true, force: true})
  fs.mkdirSync(path, {recursive: true})
  fs.writeFileSync(path + '/evidence.txt', second ? 'success' : 'failure trace')
}
fs.writeFileSync('attempted', '')
process.exit(second ? 0 : 1)
`,
    { mode: 0o755 }
  )
  writeFileSync(join(bin, 'pkill'), '#!/usr/bin/env node\nprocess.exit(1)\n', {
    mode: 0o755
  })
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./run-check.ts', import.meta.url)), 'e2e'],
    {
      cwd: folder,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
      encoding: 'utf8'
    }
  )
  assert.equal(result.status, 0, result.stderr)
  for (const directory of ['test-results', 'playwright-report']) {
    assert.equal(
      readFileSync(
        join(folder, `apps/web/${directory}-attempt-1/evidence.txt`),
        'utf8'
      ),
      'failure trace'
    )
    assert.equal(
      readFileSync(join(folder, `apps/web/${directory}/evidence.txt`), 'utf8'),
      'success'
    )
  }
})
