/// <reference types="node" />
// oxlint-disable effect/noGlobals -- subprocess tests inherit only PATH, explicitly excluding any real provider credentials
// oxlint-disable-next-line effect/noNodeBuiltinImport -- verifies the actual opt-in CLI exits before inference without authorization
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vite-plus/test'

it('refuses a paid invocation without credentials and refuses ordinary invocation', () => {
  for (const args of [[], ['--paid']]) {
    const result = spawnSync(process.execPath, ['eval/run.ts', ...args], {
      cwd: new URL('..', import.meta.url),
      env: { PATH: process.env.PATH },
      encoding: 'utf8'
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unverified paid evaluation')
  }
})

it('refuses paid inference in CI even with a credential value', () => {
  const result = spawnSync(process.execPath, ['eval/run.ts', '--paid'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH, CI: '1', OPENAI_API_KEY: 'not-a-real-key' },
    encoding: 'utf8'
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Unverified paid evaluation')
  expect(result.stderr).not.toContain('not-a-real-key')
})
