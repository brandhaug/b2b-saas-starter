import * as Schema from 'effect/Schema'
import {
  productionStage,
  stageResourceNames,
  workersDevUrl,
  type WorkerApp
} from './bindings.ts'

const Hostname = Schema.String.check(
  Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/)
)
const Domain = Schema.Struct({
  name: Hostname,
  zoneId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))
})
export type DeploymentDomains = Partial<Record<WorkerApp, typeof Domain.Type>>
const decodeDomains = Schema.decodeUnknownSync(
  Schema.Struct({
    web: Schema.optional(Domain),
    api: Schema.optional(Domain),
    background: Schema.optional(Domain)
  })
)
const decodeSubdomainName = Schema.decodeUnknownSync(
  Schema.String.check(Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/))
)

export function deploymentOrigins(
  stage: string,
  subdomain: string,
  configuredDomains: DeploymentDomains = {}
) {
  const domains = decodeDomains(configuredDomains)
  const workersSubdomain = decodeSubdomainName(subdomain)
  const names = stageResourceNames(stage)
  function origin(app: WorkerApp) {
    const domain = stage === productionStage ? domains[app] : undefined
    return domain
      ? `https://${domain.name}`
      : workersDevUrl(names.worker(app), workersSubdomain)
  }
  return { web: origin('web'), api: origin('api'), background: origin('background') }
}

const decodeSubdomainResponse = Schema.decodeUnknownSync(
  Schema.Struct({ result: Schema.Struct({ subdomain: Schema.NonEmptyString }) })
)

export async function resolveSubdomain(
  accountId: string,
  token: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch
): Promise<string> {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!response.ok) {
    throw new Error(`Cloudflare API returned HTTP ${response.status}`)
  }
  return decodeSubdomainName(
    decodeSubdomainResponse(await response.json()).result.subdomain
  )
}
