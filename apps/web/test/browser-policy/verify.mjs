// oxlint-disable effect/noNodeBuiltinImport -- this Node verifier owns real browser child processes, server lifetimes and evidence files
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFileSync, mkdirSync, createWriteStream } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../../..')
const sentinel = createServer((request, response) => response.end('unrelated'))
sentinel.listen(0, '127.0.0.1')
await once(sentinel, 'listening')
const sentinelURL = `http://127.0.0.1:${sentinel.address().port}`
try {
  for (const { name, args, outcome } of [
    { name: 'original', args: [], outcome: 'unexpected' },
    { name: 'diagnostic-retry', args: ['--retries=1'], outcome: 'flaky' },
    { name: 'cancelled', args: [], outcome: 'skipped' }
  ]) {
    const portReservation = createServer()
    portReservation.listen(0, '127.0.0.1')
    await once(portReservation, 'listening')
    const port = portReservation.address().port
    await new Promise((_resolve) => {
      portReservation.close(_resolve)
    })
    const directory = resolve(root, `.context/browser-policy/${name}`)
    mkdirSync(directory, { recursive: true })
    const log = createWriteStream(`${directory}/runner.log`)
    const child = spawn(
      process.execPath,
      [
        resolve(root, 'apps/web/scripts/playwright.mjs'),
        'test',
        '--config',
        resolve(import.meta.dirname, 'playwright.config.ts'),
        ...args
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          POLICY_PORT: String(port),
          POLICY_CANCEL: name === 'cancelled' ? '1' : '',
          POLICY_PID: `${directory}/server.pid`,
          POLICY_REPORT: `${directory}/results.json`,
          POLICY_OUTPUT: `${directory}/test-results`
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    let stdout = ''
    let cancelled = false
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (
        name === 'cancelled' &&
        !cancelled &&
        stdout.includes('POLICY_CANCEL_READY')
      ) {
        cancelled = true
        child.kill('SIGTERM')
      }
    })
    const [code] = await once(child, 'close')
    log.end()
    assert.notEqual(code, 0, name)
    const pid = Number(readFileSync(`${directory}/server.pid`, 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    const report = JSON.parse(readFileSync(`${directory}/results.json`, 'utf8'))
    const test = report.suites[0].specs[0].tests[0]
    assert.equal(test.status, outcome)
    if (name === 'cancelled') {
      assert.equal(test.results[0].status, 'interrupted')
    }
    assert.equal(test.results.length, name === 'diagnostic-retry' ? 2 : 1)
    assert.ok(test.results[0].attachments.some((item) => item.name === 'trace'))
    const response = await fetch(sentinelURL)
    assert.equal(await response.text(), 'unrelated')
    console.log(
      `${name}: exit ${code}, ${test.status}, original trace saved, owned server stopped, unrelated server alive`
    )
  }
} finally {
  sentinel.closeAllConnections()
  await new Promise((_resolve) => {
    sentinel.close(_resolve)
  })
}
