// oxlint-disable-next-line effect/noNodeBuiltinImport -- the guard reads the quickstart off the repo's content tree; a colocated test runs in Node, not in a Worker
import { readFileSync } from 'node:fs'
// oxlint-disable-next-line effect/noNodeBuiltinImport -- same: resolving the content path is a Node-side job, and the test never ships to the Worker
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { CLONE_AND_SETUP_STEPS } from './toolchain'

/**
 * The quickstart is the canonical install story; the hero and closing block
 * print `SETUP_STEPS` as what it takes to run the starter. If a command here
 * stops appearing in the quickstart verbatim — renamed script, reordered
 * block, moved doc — one of the two is lying, and this test names the
 * mismatch instead of shipping a landing page the docs contradict.
 */
const quickstart = readFileSync(
  resolve(import.meta.dirname, '../../content/docs/getting-started/quickstart.mdx'),
  'utf8'
)

describe('copyable quickstart', () => {
  it('includes every documented command in execution order', () => {
    const commands = quickstart
      .match(/```bash\n([\s\S]*?)```/)?.[1]
      ?.trim()
      .split('\n')
    expect(CLONE_AND_SETUP_STEPS).toEqual(commands)
  })

  it('enters the repository and prepares the environment before database setup', () => {
    expect(CLONE_AND_SETUP_STEPS).toEqual([
      'git clone https://github.com/brandhaug/b2b-saas-starter.git',
      'cd b2b-saas-starter',
      'vp install',
      'cp .env.example .env',
      'pnpm run db:migrate:local',
      'pnpm run db:seed',
      'pnpm run dev'
    ])
  })
})
