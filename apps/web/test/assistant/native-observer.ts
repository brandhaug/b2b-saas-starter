import { Effect, Schema } from 'effect'
import { type Response, type MessageEvent, type CloseEvent } from 'miniflare'

const decodeText = Schema.decodeUnknownResult(Schema.String)
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

/** Observe the actual SDK socket; application generation still uses admission HTTP. */
export const nativeObserver = Effect.fn('ConversationHostTest.nativeObserver')(
  function* (response: Response) {
    const socket = response.webSocket
    if (response.status !== 101 || socket === null) {
      return yield* Effect.die(`Socket upgrade returned ${response.status}.`)
    }
    const frames: Array<string> = []
    let closed: number | undefined
    socket.addEventListener('message', (event) => {
      const decoded = decodeText(event.data)
      if (decoded._tag === 'Success') {
        frames.push(decoded.success)
      }
    })
    socket.addEventListener('close', (event) => {
      closed = event.code
    })
    yield* Effect.acquireRelease(
      Effect.sync(() => socket.accept()),
      () =>
        Effect.sync(() => {
          if (socket.readyState === 1) {
            socket.close(1000, 'Test complete')
          }
        })
    )
    const waitForFrame = Effect.fn('ConversationHostTest.waitForFrame')(
      (includes: string) =>
        Effect.callback<string>((resume) => {
          const existing = frames.find((frame) => frame.includes(includes))
          if (existing !== undefined) {
            resume(Effect.succeed(existing))
            return
          }
          function receive(event: MessageEvent) {
            const decoded = decodeText(event.data)
            if (decoded._tag === 'Success' && decoded.success.includes(includes)) {
              resume(Effect.succeed(decoded.success))
            }
          }
          socket.addEventListener('message', receive)
          return Effect.sync(() => socket.removeEventListener('message', receive))
        }).pipe(
          Effect.timeout('5 seconds'),
          Effect.catchTag('TimeoutError', () =>
            Effect.die(`No socket frame containing ${includes}`)
          )
        )
    )
    const waitForClose = Effect.callback<number>((resume) => {
      if (closed !== undefined) {
        resume(Effect.succeed(closed))
        return
      }
      function receive(event: CloseEvent) {
        resume(Effect.succeed(event.code))
      }
      socket.addEventListener('close', receive)
      return Effect.sync(() => socket.removeEventListener('close', receive))
    }).pipe(
      Effect.timeout('5 seconds'),
      Effect.catchTag('TimeoutError', () => Effect.die('Socket did not close'))
    )
    const send = Effect.fn('ConversationHostTest.socketSend')((frame: Schema.Json) =>
      Effect.sync(() => socket.send(encodeJson(frame)))
    )
    return {
      frames,
      waitForFrame,
      waitForClose,
      send,
      close: Effect.sync(() => socket.close(1000, 'Observer disconnected'))
    }
  }
)
