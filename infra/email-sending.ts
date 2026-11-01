import { isResolved } from 'alchemy/Diff'
import * as Provider from 'alchemy/Provider'
import { Resource } from 'alchemy/Resource'
import { Effect, Schema } from 'effect'
import { authenticatedEmailClient } from './email-sending/api.ts'
import {
  ensureSenderPrivacy,
  type SenderPrivacyAttributes,
  SenderPrivacyProps
} from './email-sending/sender-privacy.ts'
import { makeEmailSendingLifecycle } from './email-sending/subscription.ts'
import {
  type EmailSendingSubscriptionAttributes,
  type EmailSendingSubscriptionProps
} from './email-sending/subscription-model.ts'

export { discoverEmailEventsQueue } from './email-sending/queue-discovery.ts'
export {
  ensureSenderPrivacy,
  type SenderPrivacyAttributes,
  type SenderPrivacyProps
} from './email-sending/sender-privacy.ts'
export { makeEmailSendingLifecycle } from './email-sending/subscription.ts'
export type {
  EmailSendingSubscriptionAttributes,
  EmailSendingSubscriptionProps
} from './email-sending/subscription-model.ts'

export type EmailSendingSubscription = Resource<
  'Starter.EmailSendingSubscription',
  EmailSendingSubscriptionProps,
  EmailSendingSubscriptionAttributes
>
export const EmailSendingSubscription = Resource<EmailSendingSubscription>(
  'Starter.EmailSendingSubscription'
)

/** Uses existing Alchemy credentials; never creates or expands token permissions. */
export const EmailSendingSubscriptionProvider = Provider.effect(
  EmailSendingSubscription,
  Effect.gen(function* () {
    const environment = yield* authenticatedEmailClient
    const lifecycle = yield* makeEmailSendingLifecycle(environment)
    return {
      stables: ['subscriptionId', 'accountId', 'zoneId', 'domain', 'queueId'],
      diff: ({ olds, news }) =>
        Effect.sync(() => {
          if (
            !isResolved(news) ||
            olds.accountId !== news.accountId ||
            olds.zoneId !== news.zoneId ||
            olds.domain !== news.domain ||
            olds.queueId !== news.queueId
          ) {
            return { action: 'replace', deleteFirst: true }
          }
        }),
      read: Effect.fn('EmailSending.providerRead')(function* ({ olds, output }) {
        return yield* lifecycle.read(olds, output)
      }),
      reconcile: Effect.fn('EmailSending.providerReconcile')(function* ({
        news,
        output
      }) {
        return yield* lifecycle.reconcile(news, output)
      }),
      delete: Effect.fn('EmailSending.providerDelete')(function* ({ output }) {
        yield* lifecycle.delete(output)
      })
    }
  })
)

/** Read-only gate after native sender reconciliation, before event subscriptions. */
export type EmailSendingPrivacy = Resource<
  'Starter.EmailSendingPrivacy',
  SenderPrivacyProps & {
    readonly senderState: {
      readonly enabled: boolean
      readonly previewEnabled: boolean | undefined
    }
  },
  SenderPrivacyAttributes
>
export const EmailSendingPrivacy = Resource<EmailSendingPrivacy>(
  'Starter.EmailSendingPrivacy'
)
const isSenderPrivacyScope = Schema.is(SenderPrivacyProps)
export const EmailSendingPrivacyProvider = Provider.succeed(EmailSendingPrivacy, {
  stables: ['accountId', 'zoneId', 'subdomainId', 'domain'],
  diff: ({ olds, news }) =>
    Effect.sync(() => {
      // Mutable native status outputs trigger an update, not identity replacement.
      if (
        !isSenderPrivacyScope(news) ||
        olds.accountId !== news.accountId ||
        olds.zoneId !== news.zoneId ||
        olds.subdomainId !== news.subdomainId ||
        olds.domain !== news.domain
      ) {
        return { action: 'replace', deleteFirst: true }
      }
    }),
  // No read hook: drift repair belongs to SendingSubdomain. A second drift reader
  // would race that resource's repair; its non-stable outputs rerun this gate.
  reconcile: Effect.fn('EmailSending.privacyReconcile')(function* ({ news }) {
    return yield* ensureSenderPrivacy(news)
  }),
  // Removing this preference resource must never re-enable message retention.
  delete: () => Effect.void
})
