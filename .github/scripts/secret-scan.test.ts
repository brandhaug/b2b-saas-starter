import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const binary = process.env.GITLEAKS_BINARY ?? 'gitleaks'

await test('secret detection catches and permits synthetic fixtures', (t) => {
  let versionOutput = ''
  try {
    versionOutput = execFileSync(binary, ['version'], { encoding: 'utf8' })
  } catch (error) {
    if (process.env.GITLEAKS_BINARY) {
      throw error
    }
    t.skip('gitleaks is unavailable')
    return
  }
  assert.match(versionOutput, /\d+\.\d+/)

  const directory = mkdtempSync(join(tmpdir(), 'secret-scan-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  execFileSync('git', ['-C', directory, 'init', '--quiet'])
  execFileSync('git', ['-C', directory, 'config', 'user.email', 'test@example.invalid'])
  execFileSync('git', ['-C', directory, 'config', 'user.name', 'Synthetic Test'])

  writeFileSync(join(directory, 'clean.txt'), 'ordinary configuration\n')
  execFileSync('git', ['-C', directory, 'add', 'clean.txt'])
  execFileSync('git', ['-C', directory, 'commit', '--quiet', '-m', 'clean fixture'])
  execFileSync(binary, ['detect', '--source', directory, '--redact', '25'], {
    stdio: 'pipe'
  })

  writeFileSync(
    join(directory, 'fixture.env'),
    [
      'AWS_ACCESS_KEY_ID=',
      ['AKIA', 'IOSFODNN7', 'NOTREAL'].join(''),
      '\nAWS_SECRET_ACCESS_KEY=',
      ['wJalrXUtnFEMI', '/K7MDENG/bPxRfi', 'CYNOTREALKEY'].join(''),
      '\n'
    ].join('')
  )
  execFileSync('git', ['-C', directory, 'add', 'fixture.env'])
  execFileSync('git', ['-C', directory, 'commit', '--quiet', '-m', 'secret fixture'])
  const scan = spawnSync(binary, ['detect', '--source', directory, '--redact', '25'], {
    encoding: 'utf8'
  })
  assert.ifError(scan.error)
  assert.equal(scan.status, 1)
})
