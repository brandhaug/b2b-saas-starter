import * as Alchemy from 'alchemy'
import { localState } from 'alchemy/State/LocalState'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as zones from '@distilled.cloud/cloudflare/zones'
import { Config, Effect } from 'effect'
import { SourceError } from 'effect/ConfigProvider'
import dns from './dns.config.ts'
import deployment from './deployment.config.ts'
import { validateDnsRecords } from './infra/dns-settings.ts'

function configurationError(message: string, cause?: unknown) {
  return new Config.ConfigError(new SourceError({ message, cause }))
}

export default Alchemy.Stack(
  'b2b-saas-starter-dns',
  {
    providers: Cloudflare.providers(),
    state: localState()
  },
  Effect.gen(function* () {
    if ((yield* Alchemy.Stage) !== 'prod') {
      return yield* Effect.fail(
        configurationError('DNS infrastructure requires --stage prod')
      )
    }
    if (!dns.enabled) {
      return { enabled: false }
    }
    const { records } = dns
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment
    if (accountId !== dns.accountId) {
      return yield* Effect.fail(
        configurationError('DNS profile must select the configured account')
      )
    }
    const observed = yield* Effect.forEach(
      [...new Set(records.map((record) => record.zoneId))],
      (zoneId) => zones.getZone({ zoneId }),
      { concurrency: 4 }
    ).pipe(
      Effect.mapError((cause) =>
        configurationError('Cannot verify DNS zone ownership', cause)
      )
    )
    yield* Effect.try({
      try: () =>
        validateDnsRecords(
          accountId,
          records,
          observed,
          deployment.production.domains ?? {}
        ),
      catch: (cause) => configurationError('Invalid DNS configuration', cause)
    })
    for (const { key, ...record } of records) {
      yield* Cloudflare.DNS.Record(key, record)
    }
    return { enabled: true, recordCount: records.length }
  })
)
