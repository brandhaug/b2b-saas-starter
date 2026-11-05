/// <reference types="node" />
// oxlint-disable-next-line effect/noNodeBuiltinImport -- real child Vitest exit status proves teardown failures survive caught request errors
import { spawnSync } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import { expect, it } from 'vite-plus/test'

it('fails caught native, Effect and production requests at teardown; restores stubs', () => {
  const result = spawnSync(
    'vp',
    ['test', 'run', '--config', 'test/network-fixture.config.ts'],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8'
    }
  )
  const output = stripVTControlCharacters(result.stdout + result.stderr)
  expect({
    status: result.status,
    failed: output.includes('Unexpected external network attempt')
  }).toEqual({ status: 1, failed: true })
  expect(output).toContain('3 failed | 2 passed')
  expect(output).toContain('Unexpected external network attempt')
  expect(output).not.toContain('secret-query')
})
