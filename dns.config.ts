import { type DnsSettings } from './infra/dns-settings.ts'

/** Public DNS records only. Worker custom domains stay in deployment.config.ts. */
const dns: DnsSettings = { enabled: false }
export default dns
