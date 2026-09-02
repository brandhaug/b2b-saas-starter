// oxlint-disable effect/noNodeBuiltinImport -- a guard test reads the repo's checked-in files and root package.json; it runs in Node by design, not in a Worker
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  DB_MIGRATE_COMMAND,
  DB_SEED_COMMAND,
  DEV_COMMAND,
  DEV_SERVERS,
  INSTALL_AND_RUN,
  INSTALL_COMMAND,
  PACKAGE_MANAGER
} from './toolchain'

/**
 * Guards the public site's copied commands against toolchain drift. The repo
 * moved Bun → pnpm and Turbo → Vite Task once already; these tests fail if the
 * root `package.json` moves again without `toolchain.ts` following, or if a
 * `bun `/`turbo` command string sneaks back into published MDX or landing
 * components.
 */

// Vitest runs this package with cwd = apps/web; the repo root is two up.
const ROOT = resolve(process.cwd(), '../..')

function readRoot(relative: string): string {
  return readFileSync(resolve(ROOT, relative), 'utf8')
}

describe('toolchain constants', () => {
  // JSON.parse returns `any`; the annotation is the contract, no assertion needed.
  const pkg: {
    packageManager: string
    scripts: Record<string, string>
  } = JSON.parse(readRoot('package.json'))

  it('names the package manager package.json pins', () => {
    expect(pkg.packageManager.startsWith(`${PACKAGE_MANAGER}@`)).toBe(true)
  })

  it('matches the real script names', () => {
    expect(pkg.scripts['dev']).toContain('dev')
    expect(pkg.scripts['build']).toBeDefined()
    expect(pkg.scripts['deploy']).toBeDefined()
    expect(pkg.scripts['db:migrate:local']).toBeDefined()
    expect(pkg.scripts['db:seed']).toBeDefined()
    expect(DEV_COMMAND).toBe('pnpm run dev')
    expect(INSTALL_COMMAND).toBe('pnpm install')
    expect(INSTALL_AND_RUN).toBe('pnpm install && pnpm run dev')
    expect(DB_MIGRATE_COMMAND).toBe('pnpm run db:migrate:local')
    expect(DB_SEED_COMMAND).toBe('pnpm run db:seed')
  })

  it('lists only the dev servers the dev task actually boots', () => {
    const labels = DEV_SERVERS.map((server) => server.label)
    expect(labels).toStrictEqual(['web', 'api', 'background', 'providers'])
  })
})

describe('no retired toolchain strings in published surfaces', () => {
  // MDX under apps/web/content plus the landing components are what visitors
  // copy from. Any `bun `/`turbo` command here is wrong by construction — the
  // real commands come from lib/toolchain.ts.
  const FILES = [
    'apps/web/content/docs/getting-started/quickstart.mdx',
    'apps/web/src/components/landing/hero-section.tsx',
    'apps/web/src/components/landing/closing-section.tsx',
    'apps/web/src/components/landing/runtime-map-section.tsx',
    'apps/web/src/lib/content.ts'
  ]

  it.each(FILES)('has no bun/turbo commands: %s', (file) => {
    const source = readRoot(file)
    expect(source).not.toMatch(/\bbun\s+(install|run|x|pm)\b/)
    expect(source).not.toMatch(/\bturbo\b/)
  })
})
