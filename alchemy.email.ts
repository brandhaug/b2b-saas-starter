import * as Alchemy from 'alchemy'
import * as Cloudflare from '@alchemy.run/cloudflare'
import { localState } from 'alchemy/State/LocalState'
import * as Config from 'effect/Config'
import { SourceError } from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import settings from './deployment.config.ts'
import { stageResourceNames } from './infra/bindings.ts'
import { emailSettings } from './infra/email-settings.ts'
import { validateEmailSender } from './infra/email-sending/api.ts'
import {
  discoverEmailEventsQueue,
  EmailSendingPrivacy,
  EmailSendingPrivacyProvider,
  EmailSendingSubscription,
  EmailSendingSubscriptionProvider
} from './infra/email-sending.ts'

function configurationError(cause: unknown) {
  return new Config.ConfigError(
    new SourceError({
      message:
        'Email provisioning requires production.emailSending and the deployed production email-events queue',
      cause
    })
  )
}

export default Alchemy.Stack(
  'b2b-saas-starter-email',
  {
    providers: Layer.mergeAll(
      EmailSendingPrivacyProvider,
      EmailSendingSubscriptionProvider
    ).pipe(
      Layer.provideMerge(Cloudflare.providers()),
      Layer.provide(FetchHttpClient.layer)
    ),
    state: localState()
  },
  Effect.gen(function* () {
    const accountId = yield* Config.String('CLOUDFLARE_ACCOUNT_ID')
    const sender = yield* Effect.try({
      try: () => emailSettings(settings.production.emailSending),
      catch: configurationError
    })
    const queueId = yield* discoverEmailEventsQueue({
      accountId,
      queueName: stageResourceNames('prod').emailEventsQueue
    }).pipe(Effect.mapError(configurationError))
    yield* validateEmailSender({
      accountId,
      zoneId: sender.zoneId,
      domain: sender.domain
    }).pipe(Effect.mapError(configurationError))
    const sending = yield* Cloudflare.Email.SendingSubdomain('sender', {
      zoneId: sender.zoneId,
      name: sender.domain
    })
    const privacy = yield* EmailSendingPrivacy('sender-privacy', {
      accountId,
      zoneId: sending.zoneId,
      subdomainId: sending.subdomainId,
      domain: sending.name
    })
    const subscription = yield* EmailSendingSubscription('email-lifecycle-events', {
      accountId,
      zoneId: privacy.zoneId,
      domain: privacy.domain,
      queueId,
      name: 'b2b-saas-starter-prod-email-events'
    })
    return { sender: sending.name, subscriptionId: subscription.subscriptionId }
  })
)
