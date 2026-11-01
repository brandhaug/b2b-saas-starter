import { Effect } from 'effect'
import * as Queues from '@distilled.cloud/cloudflare/queues'
import {
  checkEnvironment,
  checkPage,
  emailOperations,
  failure,
  missing,
  validateSenderZone
} from './api.ts'
import {
  decodeSubscription,
  decodeSubscriptions,
  attributes,
  decodeProps,
  events,
  sameEvents,
  sameSource,
  type EmailSendingSubscriptionAttributes,
  type EmailSendingSubscriptionProps,
  type Subscription
} from './subscription-model.ts'

function decode(value: unknown) {
  return decodeSubscription(value).pipe(
    Effect.mapError(() => failure('decode', 'Malformed Cloudflare subscription'))
  )
}

/** Captures the SDK credentials and HTTP transport. Construction makes no requests. */
export const makeEmailSendingLifecycle = Effect.fn('EmailSending.makeLifecycle')(
  function* (environment: { accountId: string; stage: string }) {
    const run = yield* emailOperations
    const accountId = environment.accountId
    const checkScope = Effect.fn('EmailSending.checkScope')(function* (
      props: EmailSendingSubscriptionProps
    ) {
      yield* checkEnvironment(environment, props.accountId)
      yield* decodeProps(props).pipe(
        Effect.mapError(() =>
          failure(
            'scope',
            'Invalid email subscription account, zone, domain, queue, or name'
          )
        )
      )
    })
    function get(id: string) {
      return missing(
        run('GET', Queues.getSubscription({ accountId, subscriptionId: id })).pipe(
          Effect.flatMap(decode)
        )
      )
    }
    const assertObserved = Effect.fn('EmailSending.assertObserved')(function* (
      value: Subscription,
      scope: EmailSendingSubscriptionProps,
      id?: string
    ) {
      if (
        !sameSource(value, scope) ||
        value.destination.queueId !== scope.queueId ||
        (id !== undefined && value.id !== id)
      ) {
        return yield* failure(
          'scope',
          'Observed subscription does not match the owned source/queue scope'
        )
      }
    })
    const find = Effect.fn('EmailSending.find')(function* (
      props: EmailSendingSubscriptionProps
    ) {
      const matches: Array<Subscription> = []
      let current = 1
      let total = 1
      do {
        const response = yield* run(
          'GET',
          Queues.listSubscriptions({ accountId, page: current, perPage: 100 })
        )
        const info = response.resultInfo
        if (
          info?.page === undefined ||
          info.page === null ||
          info.totalPages === undefined ||
          info.totalPages === null
        ) {
          return yield* failure('list', 'Malformed Cloudflare pagination')
        }
        yield* checkPage({ page: info.page, total_pages: info.totalPages }, current)
        total = info.totalPages
        const values = yield* decodeSubscriptions(response.result).pipe(
          Effect.mapError(() =>
            failure('list', 'Malformed Cloudflare subscription list')
          )
        )
        matches.push(...values.filter((value) => sameSource(value, props)))
        current += 1
      } while (current <= total)
      if (matches.length > 1) {
        return yield* failure(
          'list',
          'Found multiple subscriptions for the sender domain'
        )
      }
      const match = matches[0]
      if (match) {
        yield* assertObserved(match, props)
        if (match.name !== props.name) {
          return yield* failure(
            'scope',
            'Existing sender subscription belongs to another resource name'
          )
        }
      }
      return match
    })
    const validateDestination = Effect.fn('EmailSending.validateDestination')(
      function* (props: EmailSendingSubscriptionProps) {
        yield* validateSenderZone(run, props)
        const queue = yield* run(
          'GET',
          Queues.getQueue({ accountId, queueId: props.queueId })
        )
        if (queue.queueId !== props.queueId) {
          return yield* failure(
            'scope',
            'Queue response does not match the configured queue'
          )
        }
      }
    )
    return {
      read: Effect.fn('EmailSending.read')(function* (
        props: EmailSendingSubscriptionProps,
        output?: EmailSendingSubscriptionAttributes
      ) {
        const scope = output ?? props
        yield* checkScope(scope)
        if (output) {
          const value = yield* get(output.subscriptionId)
          if (!value) {
            return
          }
          yield* assertObserved(value, scope, output.subscriptionId)
          return attributes(value, scope)
        }
        const value = yield* find(props)
        return value ? attributes(value, props) : undefined
      }),
      reconcile: Effect.fn('EmailSending.reconcile')(function* (
        props: EmailSendingSubscriptionProps,
        output?: EmailSendingSubscriptionAttributes
      ) {
        yield* checkScope(props)
        if (output) {
          yield* checkScope(output)
          if (
            output.zoneId !== props.zoneId ||
            output.domain !== props.domain ||
            output.queueId !== props.queueId
          ) {
            return yield* failure(
              'scope',
              'Changing the sender source or queue requires resource replacement'
            )
          }
        }
        yield* validateDestination(props)
        let value = output ? yield* get(output.subscriptionId) : undefined
        if (value && output) {
          yield* assertObserved(value, output, output.subscriptionId)
        }
        if (!value) {
          value = yield* find(props)
        }
        const desired: Omit<Queues.PatchSubscriptionRequest, 'subscriptionId'> = {
          accountId,
          name: props.name,
          enabled: true,
          events,
          destination: { type: 'queues.queue', queueId: props.queueId }
        }
        if (!value) {
          value = yield* run(
            'POST',
            Queues.createSubscription({
              accountId,
              name: props.name,
              enabled: true,
              events,
              destination: { type: 'queues.queue', queueId: props.queueId },
              source: {
                type: 'email.sending',
                zoneId: props.zoneId,
                domain: props.domain
              }
            })
          ).pipe(Effect.flatMap(decode))
        } else if (
          value.name !== props.name ||
          !value.enabled ||
          !sameEvents(value.events)
        ) {
          const updated = yield* run(
            'PATCH',
            Queues.patchSubscription({ ...desired, subscriptionId: value.id })
          ).pipe(Effect.flatMap(decode))
          yield* assertObserved(updated, props, value.id)
          value = updated
        }
        yield* assertObserved(value, props)
        if (!value.enabled || !sameEvents(value.events) || value.name !== props.name) {
          return yield* failure(
            'reconcile',
            'Cloudflare did not apply the requested subscription settings'
          )
        }
        return attributes(value, props)
      }),
      delete: Effect.fn('EmailSending.delete')(function* (
        output: EmailSendingSubscriptionAttributes
      ) {
        yield* checkScope(output)
        const value = yield* get(output.subscriptionId)
        if (!value) {
          return
        }
        yield* assertObserved(value, output, output.subscriptionId)
        yield* missing(
          run(
            'DELETE',
            Queues.deleteSubscription({ accountId, subscriptionId: value.id })
          )
        )
      })
    }
  }
)
