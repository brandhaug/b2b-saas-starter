import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
// The stack's deployment-time provider readers use process.env. Alchemy's
// ConfigProvider-only dotenv loading does not populate those readers.
const envFile = resolve(root, '.env')
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}
const seed = resolve(root, '.alchemy/local-seed.sql')
execFileSync(process.execPath, ['packages/i18n/scripts/compile.mjs'], {
  cwd: root,
  stdio: 'inherit'
})
// Keep the import stable across restarts: Alchemy imports SQL only when its
// content changes, so starting development never resets edited demo records.
if (!existsSync(seed)) {
  mkdirSync(resolve(root, '.alchemy'), { recursive: true })
  writeFileSync(
    seed,
    execFileSync(process.execPath, ['scripts/seed.ts', '--print'], {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024
    })
  )
}
const child = spawn(
  resolve(root, 'node_modules/.bin/alchemy'),
  ['dev', '--stage', 'local'],
  {
    cwd: root,
    stdio: 'inherit'
  }
)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal))
}
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
