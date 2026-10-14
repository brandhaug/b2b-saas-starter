import { Effect, Schema } from 'effect'
import { HttpClientRequest } from 'effect/http'
import {
  Identifier,
  PageInfo,
  apiUrl,
  authenticatedEmailClient,
  checkEnvironment,
  checkPage,
  emailApi,
  envelope,
  failure
} from './api.ts'

const Lookup = Schema.Struct({
  accountId: Identifier,
  queueName: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,63}$/u))
})
type Lookup = Schema.Schema.Type<typeof Lookup>
const decodeLookup = Schema.decodeEffect(Lookup)
const Queue = Schema.Struct({ queue_id: Identifier, queue_name: Schema.NonEmptyString })
const QueuePage = Schema.Struct({
  success: Schema.Literal(true),
  result: Schema.Array(Queue),
  result_info: Schema.optionalKey(PageInfo)
})
const QueueDetail = envelope(Queue)

/** Read-only lookup; the app stack continues to own this queue.
 * Wire query follows Wrangler 4.149.0 deploy-helpers/src/triggers/queue-consumers.ts.
 * https://developers.cloudflare.com/api/resources/queues/methods/list/
 */
export const discoverEmailEventsQueue = Effect.fn('EmailSending.discoverQueue')(
  function* (input: Lookup) {
    const environment = yield* authenticatedEmailClient
    yield* checkEnvironment(environment, input.accountId)
    const props = yield* decodeLookup(input).pipe(
      Effect.mapError(() => failure('lookup', 'Invalid account or queue name'))
    )
    const api = emailApi(environment.client)
    const collection = `${apiUrl}/accounts/${props.accountId}/queues`
    const matches: Array<Schema.Schema.Type<typeof Queue>> = []
    let current = 1
    let hasMore = true
    while (hasMore && current <= 1000) {
      const response = yield* api.decode(
        QueuePage,
        HttpClientRequest.get(collection).pipe(
          HttpClientRequest.setUrlParams({ page: current, name: props.queueName })
        )
      )
      matches.push(
        ...response.result.filter((queue) => queue.queue_name === props.queueName)
      )
      if (response.result_info) {
        yield* checkPage(response.result_info, current)
        hasMore = current < response.result_info.total_pages
      } else {
        hasMore = response.result.length > 0
      }
      current += 1
    }
    if (hasMore) {
      return yield* failure('list', 'Excessive queue pagination')
    }
    if (matches.length > 1) {
      return yield* failure(
        'lookup',
        'Found multiple queues with the exact requested name'
      )
    }
    const match = matches[0]
    if (!match) {
      return yield* failure(
        'lookup',
        `Production email-events queue not found: ${props.queueName}`
      )
    }
    const response = yield* api.decode(
      QueueDetail,
      HttpClientRequest.get(`${collection}/${match.queue_id}`)
    )
    if (
      response.result.queue_id !== match.queue_id ||
      response.result.queue_name !== props.queueName
    ) {
      return yield* failure(
        'scope',
        'Queue detail does not match the account/name/ID scope'
      )
    }
    return response.result.queue_id
  }
)
