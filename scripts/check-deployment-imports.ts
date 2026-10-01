import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = join(import.meta.dirname, '..')
const alchemyHome = await mkdtemp(join(tmpdir(), 'alchemy-import-check-'))
const checkEnvironment = {
  ...process.env,
  ALCHEMY_HOME: alchemyHome,
  BETTER_AUTH_SECRET: 'ci-import-check-placeholder-secret'
}

try {
  await exec(join(root, 'node_modules', '.bin', 'alchemy'), ['deploy', '--help'], {
    cwd: root,
    env: checkEnvironment
  })
  // Importing constructs the stack's Effect program; it does not deploy it.
  await exec(
    process.execPath,
    ['--input-type=module', '--eval', "await import('./alchemy.run.ts')"],
    { cwd: root, env: checkEnvironment }
  )
} finally {
  await rm(alchemyHome, { recursive: true, force: true })
}
