import { spawnSync } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'

type Check = 'e2e' | 'audit'

function run(command: string, args: ReadonlyArray<string>): number {
  return spawnSync(command, args, { stdio: 'inherit' }).status ?? 1
}

function preserve(attempt: number): void {
  for (const directory of ['test-results', 'playwright-report']) {
    const source = `apps/web/${directory}`
    if (existsSync(source)) {
      cpSync(source, `${source}-attempt-${attempt}`, { recursive: true })
    }
  }
}

export async function runCheck(
  check: Check,
  e2eArgs: ReadonlyArray<string> = []
): Promise<number> {
  const attempts = check === 'e2e' ? 2 : 3
  const args =
    check === 'e2e' ? ['run', 'test:e2e', ...e2eArgs] : ['audit', '--audit-level=high']
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (run('pnpm', args) === 0) {
      return 0
    }
    if (attempt < attempts) {
      console.warn(
        `::warning::${check} failed (attempt ${attempt}/${attempts}); retrying`
      )
      if (check === 'e2e') {
        // Playwright clears these directories when the next attempt starts.
        preserve(attempt)
        run('pkill', ['-f', 'vite dev'])
        run('pkill', ['-f', 'vite preview'])
        run('pkill', ['-f', 'workerd'])
      } else {
        // Registry outages should not immediately exhaust the audit retries.
        // oxlint-disable-next-line no-await-in-loop -- retries must wait in sequence
        await setTimeout(60_000)
      }
    }
  }
  return 1
}

if (import.meta.main) {
  const check = process.argv[2]
  if (check !== 'e2e' && check !== 'audit') {
    console.error('usage: node .github/scripts/run-check.ts <e2e|audit>')
    process.exitCode = 64
  } else {
    process.exitCode = await runCheck(check, process.argv.slice(3))
  }
}
