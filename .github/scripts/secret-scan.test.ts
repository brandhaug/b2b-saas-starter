import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, test } from 'vite-plus/test'

const binary = process.env.GITLEAKS_BINARY ?? 'gitleaks'

function gitleaksIsUnavailable(): boolean {
  if (process.env.GITLEAKS_BINARY) {
    return false
  }
  try {
    execFileSync(binary, ['version'], { stdio: 'pipe' })
    return false
  } catch {
    return true
  }
}

test.skipIf(gitleaksIsUnavailable())(
  'secret detection catches and permits synthetic fixtures',
  () => {
    assert.match(execFileSync(binary, ['version'], { encoding: 'utf8' }), /\d+\.\d+/)

    const directory = mkdtempSync(join(tmpdir(), 'secret-scan-'))
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
    execFileSync('git', ['-C', directory, 'init', '--quiet'])
    execFileSync('git', [
      '-C',
      directory,
      'config',
      'user.email',
      'test@example.invalid'
    ])
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
    const scan = spawnSync(
      binary,
      ['detect', '--source', directory, '--redact', '25'],
      {
        encoding: 'utf8'
      }
    )
    assert.ifError(scan.error)
    assert.equal(scan.status, 1)
  }
)
