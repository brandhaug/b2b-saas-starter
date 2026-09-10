import { appendFile } from 'node:fs/promises'

import { Schema } from 'effect'

import { stageResourceNames, type WorkerApp } from '../../infra/bindings.ts'
import { requiredEnv } from '../../scripts/lib/env.ts'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
type EnvWriter = (content: string) => Promise<void>

const decodeSubdomain = Schema.decodeUnknownSync(
  Schema.Struct({ result: Schema.Struct({ subdomain: Schema.NonEmptyString }) })
)

export async function resolveSubdomain(
  accountId: string,
  token: string,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!response.ok) {
    throw new Error(`Cloudflare API returned HTTP ${response.status}`)
  }
  return decodeSubdomain(await response.json()).result.subdomain
}

/**
 * The workers.dev URLs are not known until deploy time: the subdomain comes
 * from the Cloudflare API and the worker names from `stageResourceNames`, so
 * both the production deploy and the per-PR previews derive them here.
 */
export function stageEnv(subdomain: string, stage: string): string {
  const { worker } = stageResourceNames(stage)
  function url(app: WorkerApp): string {
    return `https://${worker(app)}.${subdomain}.workers.dev`
  }
  return [
    `CLOUDFLARE_WORKERS_SUBDOMAIN=${subdomain}`,
    `WEB_URL=${url('web')}`,
    `API_URL=${url('api')}`,
    `BACKGROUND_URL=${url('background')}`
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
