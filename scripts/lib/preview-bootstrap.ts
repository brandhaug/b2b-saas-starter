import { type Policy } from '@alchemy.run/cloudflare/ApiToken'
import * as Config from 'effect/Config'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

/** Stage names do not constrain account API tokens; previews need another account. */
export function previewBootstrapConfig(productionAccountId: string) {
  return Config.schema(
    Schema.String.check(
      Schema.isPattern(/^[a-f0-9]{32}$/),
      Schema.makeFilter(
        (value) =>
          value !== productionAccountId || 'Preview account must differ from production'
      )
    ),
    'BOOTSTRAP_PREVIEW_ACCOUNT_ID'
  ).pipe(
    Config.option,
    Config.map((configured) => {
      const accountId = Option.getOrNull(configured)
      if (accountId === null) {
        return null
      }
      const policies: Array<Policy> = [
        {
          effect: 'allow',
          permissionGroups: [
            'Workers Scripts Write',
            'D1 Write',
            'Secrets Store Write'
          ],
          resources: { [`com.cloudflare.api.account.${accountId}`]: '*' }
        }
      ]
      return { accountId, policies }
    })
  )
}
