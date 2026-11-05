import { spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

function run(command: string, args: ReadonlyArray<string>): number {
  return spawnSync(command, args, { stdio: 'inherit' }).status ?? 1
}

export async function runCheck(): Promise<number> {
  const attempts = 3
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (run('pnpm', ['audit', '--audit-level=high']) === 0) {
      return 0
    }
    if (attempt < attempts) {
      console.warn(`::warning::audit failed (attempt ${attempt}/${attempts}); retrying`)
      // Registry outages should not immediately exhaust the audit retries.
      // oxlint-disable-next-line no-await-in-loop -- retries must wait in sequence
      await setTimeout(60_000)
    }
  }
  return 1
}

if (import.meta.main) {
  const check = process.argv[2]
  if (check === 'audit') {
    process.exitCode = await runCheck()
  } else {
    console.error('usage: node .github/scripts/run-check.ts audit')
    process.exitCode = 64
  }
}
