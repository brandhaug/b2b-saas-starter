import type { D1Database } from '@cloudflare/workers-types'
import { env as baseEnv } from './cloudflare-workers-shim.ts'

const provisionBrowserTestD1 = async () => {
  if (!import.meta.env.SSR) return undefined
  const persistPath = process.env.OPERATIONS_BROWSER_TEST_D1_PATH
  if (!persistPath) throw new Error('OPERATIONS_BROWSER_TEST_D1_PATH is required')
  const [{ getPlatformProxy }, { localD1Paths }] = await Promise.all([
    import('wrangler'),
    import('@b2b-saas-starter/db/local-development')
  ])
  return getPlatformProxy<{ DB: D1Database }>({
    configPath: localD1Paths.configPath,
    persist: { path: persistPath }
  })
}

const testD1 = await provisionBrowserTestD1()

export const env = {
  ...baseEnv,
  ENVIRONMENT: 'test',
  DB: testD1?.env.DB as D1Database
}

export const disposeBrowserTestD1 = async (): Promise<void> => {
  await testD1?.dispose()
}
