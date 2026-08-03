import { resolve } from 'node:path'
import { releaseBaselineVerificationSuites } from './fixture-evidence.ts'

const root = resolve(import.meta.dirname, '../..')
const suites = [...new Set(releaseBaselineVerificationSuites)]
const tests = Bun.spawn(['bunx', 'vitest', 'run', ...suites], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit'
})
process.exit(await tests.exited)
