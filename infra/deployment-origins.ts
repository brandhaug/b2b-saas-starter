import * as Schema from 'effect/Schema'
import * as Effect from 'effect/Effect'
import { getSubdomain } from '@distilled.cloud/cloudflare/workers'
import { withCloudflareToken } from '../scripts/lib/cloudflare.ts'
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

export async function resolveSubdomain(
  accountId: string,
  token: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch
): Promise<string> {
  const response = await Effect.runPromise(
    withCloudflareToken(getSubdomain({ accountId }), token, (input, init) =>
      fetchImpl(input instanceof Request ? input.url : String(input), init)
    )
  )
  return decodeSubdomainName(response.subdomain)
}
