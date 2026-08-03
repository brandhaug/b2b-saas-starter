import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { D1Database } from '@cloudflare/workers-types'

export interface LocalD1Paths {
  readonly configPath: string
  readonly persistPath: string
}

/** Resolve the Wrangler config and persisted state written by local migrations. */
export const resolveLocalD1Paths = (dbPackageDir: string): LocalD1Paths => ({
  configPath: join(dbPackageDir, 'wrangler.jsonc'),
  persistPath: join(dbPackageDir, '.wrangler/state/v3')
})

const dbPackageDir = join(dirname(fileURLToPath(import.meta.url)), '..')

export const localD1Paths = resolveLocalD1Paths(dbPackageDir)

export const hasLocalD1State = (): boolean =>
  existsSync(join(localD1Paths.persistPath, 'd1'))

/** Attach the canonical persisted local D1 used by migrations and seed data. */
export const provisionLocalD1 = async (): Promise<D1Database> => {
  const { getPlatformProxy } = await import('wrangler')
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: localD1Paths.configPath,
    persist: { path: localD1Paths.persistPath }
  })
  return proxy.env.DB
}
