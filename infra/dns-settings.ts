import { type RecordProps } from '@alchemy.run/cloudflare/DNS/Record'
import { type DeploymentDomains } from './deployment-origins.ts'

type ManagedRecord = RecordProps & { key: string }
export type DnsSettings =
  | { enabled: false }
  | { enabled: true; accountId: string; records: ReadonlyArray<ManagedRecord> }

type ObservedZone = {
  id?: string | null
  name?: string | null
  account?: { id?: string | null } | null
}

/** Explicit FQDNs make zone ownership and conflicts reviewable before deployment. */
export function validateDnsRecords(
  accountId: string,
  records: ReadonlyArray<ManagedRecord>,
  zones: ReadonlyArray<ObservedZone>,
  domains: DeploymentDomains
) {
  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new Error('DNS configuration requires a Cloudflare account ID')
  }
  const keys = new Set<string>()
  const identities = new Set<string>()
  const zonesById = new Map(zones.map((zone) => [zone.id, zone]))
  const workerHosts = new Set(
    Object.values(domains).map((domain) => domain.name.toLowerCase())
  )
  for (const record of records) {
    if (!/^[a-z0-9-]+$/.test(record.key) || keys.has(record.key)) {
      throw new Error('DNS resource keys must be unique lowercase slugs')
    }
    keys.add(record.key)
    const zone = zonesById.get(record.zoneId)
    if (!zone?.name || zone.account?.id !== accountId) {
      throw new Error(
        `DNS zone for ${record.key} must belong to the configured account`
      )
    }
    const name = record.name.toLowerCase().replace(/\.$/, '')
    if (record.name !== name) {
      throw new Error(
        `DNS record ${record.key} must use its canonical lowercase name without a trailing dot`
      )
    }
    // Native discovery adopts a sole name/type candidate regardless of content.
    // Separate resources must never compete for that same provider identity.
    const identity = `${record.zoneId}/${name}/${record.type.toUpperCase()}`
    if (identities.has(identity)) {
      throw new Error(`DNS record ${record.key} has a duplicate physical identity`)
    }
    identities.add(identity)
    const zoneName = zone.name.toLowerCase().replace(/\.$/, '')
    if (name !== zoneName && !name.endsWith(`.${zoneName}`)) {
      throw new Error(
        `DNS record ${record.key} must use a fully qualified name inside its zone`
      )
    }
    if (workerHosts.has(name)) {
      throw new Error(
        `DNS record ${record.key} conflicts with a Worker-managed custom domain`
      )
    }
  }
}
