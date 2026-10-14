import { appendFile } from 'node:fs/promises'

import { deploymentOrigins, resolveSubdomain } from '../../infra/deployment-origins.ts'
import settings from '../../deployment.config.ts'
import { requiredEnv } from '../../scripts/lib/env.ts'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
type EnvWriter = (content: string) => Promise<void>

/**
 * The workers.dev URLs are not known until deploy time: the subdomain comes
 * from the Cloudflare API and the worker names from `stageResourceNames`, so
 * both the production deploy and the per-PR previews derive them here.
 */
export function stageEnv(subdomain: string, stage: string): string {
  const urls = deploymentOrigins(stage, subdomain, settings.production.domains)
  return [
    `CLOUDFLARE_WORKERS_SUBDOMAIN=${subdomain}`,
    `WEB_URL=${urls.web}`,
    `API_URL=${urls.api}`,
    `BACKGROUND_URL=${urls.background}`
  ].join('\n')
}

export async function main(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
  writeEnv: EnvWriter = async (content) => {
    await appendFile(env.GITHUB_ENV ?? '/dev/stdout', `${content}\n`)
  }
): Promise<void> {
  const stage = requiredEnv('ALCHEMY_STAGE', env)
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID', env)
  const token = requiredEnv('CLOUDFLARE_API_TOKEN', env)
  const subdomain = await resolveSubdomain(accountId, token, fetchImpl)
  await writeEnv(stageEnv(subdomain, stage))
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error('preview URL resolution failed', error)
    process.exitCode = 1
  })
}
