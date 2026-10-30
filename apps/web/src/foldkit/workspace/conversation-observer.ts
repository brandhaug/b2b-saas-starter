import { Deferred, Duration, Effect, Queue, Schedule, Stream } from 'effect'
import { conversationHistoryServerFn } from '@/lib/server/assistant-conversations'
import { readConversationSnapshot } from '@/lib/assistant-conversation-stream'
import { type Message } from './model'

/** A scoped observer: snapshots and reconnects never invoke model execution. */
export function observe(slug: string, conversationId: string, generation: number) {
  return Stream.callback<Message>((queue) =>
    Effect.gen(function* () {
      let alive = true
      let denied = false
      let retryDelay = 1000
      let nextDelay = 1000
      function emit(message: Message) {
        if (alive) {
          Queue.offerUnsafe(queue, message)
        }
      }
      function state(value: 'connected' | 'reconnecting' | 'denied') {
        emit({ _tag: 'Connection', conversationId, generation, state: value })
      }
      const load = Effect.tryPromise({
        try: () =>
          conversationHistoryServerFn({
            data: { workspaceSlug: slug, conversationId }
          }),
        catch: () => 'HistoryUnavailable' as const
      }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (denied || !alive) {
              return
            }
            if (result.ok) {
              emit({
                _tag: 'Snapshot',
                conversationId,
                generation,
                history: result.value
              })
            } else if (result.reason === 'access' || result.reason === 'not_found') {
              denied = true
              state('denied')
            }
          })
        ),
        Effect.catch(() => Effect.void)
      )
      const connect = Effect.scoped(
        Effect.gen(function* () {
          if (denied) {
            return yield* Effect.never
          }
          yield* load.pipe(Effect.forkScoped)
          const closed = yield* Deferred.make<undefined>()
          const socket = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const url = new URL(
                `/api/assistant/${encodeURIComponent(conversationId)}/connect`,
                window.location.origin
              )
              url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
              return new WebSocket(url)
            }),
            (connection) => Effect.sync(() => connection.close())
          )
          socket.addEventListener('open', () => {
            if (!denied) {
              retryDelay = 1000
              state('connected')
            }
          })
          socket.addEventListener('message', (event: MessageEvent<string>) => {
            const snapshot = readConversationSnapshot(event.data)
            if (snapshot && !denied) {
              emit({ _tag: 'Snapshot', conversationId, generation, history: snapshot })
            }
          })
          socket.addEventListener('close', (event) => {
            if (!alive) {
              return
            }
            if ([1008, 4401, 4403, 4404].includes(event.code)) {
              denied = true
              state('denied')
            } else if (!denied) {
              state('reconnecting')
              nextDelay = retryDelay
              retryDelay = Math.min(retryDelay * 2, 15_000)
            }
            Deferred.doneUnsafe(closed, Effect.succeed(undefined))
          })
          yield* Deferred.await(closed)
        })
      )
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          alive = false
        })
      )
      yield* connect.pipe(
        Effect.repeat(
          Schedule.spaced('1 second').pipe(
            Schedule.modifyDelay(() => Effect.sync(() => Duration.millis(nextDelay)))
          )
        ),
        Effect.forkScoped
      )
    })
  )
}
