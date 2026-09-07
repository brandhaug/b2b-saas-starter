import { appendFile } from 'node:fs/promises'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
type EnvWriter = (content: string) => Promise<void>

function requiredEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]
  if (!value) {
    throw new Error(`missing required environment variable ${name}`)
  }
  return value
}

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
  const body: unknown = await response.json()
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validate the untrusted Cloudflare JSON boundary.
    typeof body !== 'object' ||
    body === null ||
    !('result' in body) ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validate the untrusted Cloudflare JSON boundary.
    typeof body.result !== 'object' ||
    body.result === null ||
    !('subdomain' in body.result) ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validate the untrusted Cloudflare JSON boundary.
    typeof body.result.subdomain !== 'string' ||
    body.result.subdomain.length === 0
  ) {
    throw new Error('Cloudflare API response did not contain a workers.dev subdomain')
  }
  return body.result.subdomain
}

export function previewEnv(subdomain: string, stage: string): string {
  const prefix = `b2b-saas-starter-${stage}`
  return [
    `CLOUDFLARE_WORKERS_SUBDOMAIN=${subdomain}`,
    `WEB_URL=https://${prefix}-web.${subdomain}.workers.dev`,
    `API_URL=https://${prefix}-api.${subdomain}.workers.dev`,
    `BACKGROUND_URL=https://${prefix}-background.${subdomain}.workers.dev`
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
  await writeEnv(previewEnv(subdomain, stage))
}

if (process.argv[1] === import.meta.filename) {
  main().catch(() => {
    console.error('preview URL resolution failed')
    process.exitCode = 1
  })
}
