import { Effect } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import {
  apiUrl,
  checkEnvironment,
  checkPage,
  emailApi,
  failure,
  missing,
  validateSenderZone
} from './api.ts'
import {
  Creation,
  Deleted,
  Mutation,
  Queue,
  SubscriptionPage,
  SubscriptionResponse,
  attributes,
  decodeProps,
  events,
  sameEvents,
  sameSource,
  type EmailSendingSubscriptionAttributes,
  type EmailSendingSubscriptionProps,
  type Subscription
} from './subscription-model.ts'

/** The supplied HTTP client must already carry authentication. Construction makes no requests. */
export const makeEmailSendingLifecycle = Effect.fn('EmailSending.makeLifecycle')(
  function* (environment: { accountId: string; stage: string }) {
    const api = emailApi(yield* HttpClient.HttpClient)
    const collection = `${apiUrl}/accounts/${environment.accountId}/event_subscriptions/subscriptions`
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
        api.decode(
          SubscriptionResponse,
          HttpClientRequest.get(`${collection}/${encodeURIComponent(id)}`)
        )
      ).pipe(Effect.map((response) => response?.result))
    }
    const assertObserved = Effect.fn('EmailSending.assertObserved')(function* (
      value: Subscription,
      scope: EmailSendingSubscriptionProps,
      id?: string
    ) {
      if (
        !sameSource(value, scope) ||
        value.destination.queue_id !== scope.queueId ||
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
        const response = yield* api.decode(
          SubscriptionPage,
          HttpClientRequest.get(collection).pipe(
            HttpClientRequest.setUrlParams({ page: current, per_page: 100 })
          )
        )
        yield* checkPage(response.result_info, current)
        total = response.result_info.total_pages
        matches.push(...response.result.filter((value) => sameSource(value, props)))
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
        yield* validateSenderZone(api, props)
        const queue = yield* api.decode(
          Queue,
          HttpClientRequest.get(
            `${apiUrl}/accounts/${props.accountId}/queues/${props.queueId}`
          )
        )
        if (queue.result.queue_id !== props.queueId) {
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
        const desired = Mutation.make({
          name: props.name,
          enabled: true,
          events,
          destination: { type: 'queues.queue', queue_id: props.queueId }
        })
        if (!value) {
          const body = Creation.make({
            ...desired,
            source: {
              type: 'email.sending',
              zone_id: props.zoneId,
              domain: props.domain
            }
          })
          const input = yield* HttpClientRequest.schemaBodyJson(Creation)(
            HttpClientRequest.post(collection),
            body
          ).pipe(
            Effect.mapError(() => failure('create', 'Invalid subscription request'))
          )
          value = (yield* api.decode(SubscriptionResponse, input)).result
        } else if (
          value.name !== props.name ||
          !value.enabled ||
          !sameEvents(value.events)
        ) {
          const input = yield* HttpClientRequest.schemaBodyJson(Mutation)(
            HttpClientRequest.patch(`${collection}/${value.id}`),
            desired
          ).pipe(
            Effect.mapError(() => failure('update', 'Invalid subscription request'))
          )
          const updated = (yield* api.decode(SubscriptionResponse, input)).result
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
          api.decode(Deleted, HttpClientRequest.delete(`${collection}/${value.id}`))
        )
      })
    }
  }
)
