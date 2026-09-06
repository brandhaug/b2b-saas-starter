import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// The generated i18n modules are intentionally ignored by git. Most workspace
// commands generate them in a wrapper, but this script is also a documented
// direct Node entrypoint (`node scripts/seed.ts`). Generate in a child process
// before loading the implementation, because static ESM imports are resolved
// before a module's body runs. Suppress child stdout so `--print` remains a
// SQL-only interface; compiler diagnostics still reach stderr.
const repoRoot = join(import.meta.dirname, '..')
const i18nCompileScript = join(repoRoot, 'packages/i18n/scripts/compile.mjs')
execFileSync(process.execPath, [i18nCompileScript], {
  cwd: repoRoot,
  stdio: ['ignore', 'ignore', 'inherit']
})

// oxlint-disable-next-line effect/noDynamicImports -- generated modules must exist before Node loads the seed's import graph
await import('./seed-main.ts')
