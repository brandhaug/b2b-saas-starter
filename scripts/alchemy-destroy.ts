/** Guard Alchemy teardown with an exact account/stage confirmation. */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { parseArgs, promisify } from 'node:util'

import { requiredEnv } from './lib/env.ts'

const exec = promisify(execFile)
const ROOT = join(import.meta.dirname, '..')

export async function destroyStage(
  stage: string,
  confirmation: string | undefined
): Promise<void> {
  if (stage.trim().length === 0) {
    throw new Error('stage must not be empty')
  }
  const expected = `${requiredEnv('CLOUDFLARE_ACCOUNT_ID')}/${stage}`
  if (confirmation !== expected) {
    throw new Error(`destructive teardown requires --confirm-target=${expected}`)
  }
  const alchemy =
    process.env.ALCHEMY_DESTROY_BIN ?? join(ROOT, 'node_modules', '.bin', 'alchemy')
  await exec(alchemy, ['destroy', '--yes', '--stage', stage], {
    cwd: ROOT,
    env: process.env
  })
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      stage: { type: 'string' },
      'confirm-target': { type: 'string' }
    }
  })
  const stage = parsed.values.stage ?? process.env.ALCHEMY_STAGE
  if (stage === undefined) {
    throw new Error(
      'usage: alchemy-destroy.ts --stage=<stage> --confirm-target=<account/stage>'
    )
  }
  await destroyStage(stage, parsed.values['confirm-target'])
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
