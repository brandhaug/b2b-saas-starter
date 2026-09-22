import { Effect, Encoding, Result, Schema, Stream } from 'effect'
import {
  type ConversationAnswer,
  type ConversationQuestion
} from './assistant-conversation.ts'

export type AttemptSnapshot = {
  readonly question: ConversationQuestion
  readonly attempt: ConversationAnswer
  readonly policyRevision: number
}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const decodeReplayCursor = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Tuple([
      Schema.String,
      Schema.String,
      Schema.Int,
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      Schema.Literals(['Accepted', 'Running', 'Completed', 'Interrupted', 'Stopped'])
    ])
  )
)

function replayPosition(
  value: string | null,
  conversationId: string,
  snapshot: AttemptSnapshot
) {
  if (value === null) {
    return
  }
  const decoded = Encoding.decodeBase64String(value)
  if (Result.isFailure(decoded)) {
    return
  }
  const cursor = decodeReplayCursor(decoded.success)
  if (Result.isFailure(cursor)) {
    return
  }
  const [conversation, attempt, revision, length, status] = cursor.success
  if (
    conversation !== conversationId ||
    attempt !== snapshot.attempt.id ||
    revision !== snapshot.policyRevision ||
    length > snapshot.attempt.text.length
  ) {
    return
  }
  return { text: snapshot.attempt.text.slice(0, length), status }
}

function event(
  id: string,
  kind: string,
  data:
    | AttemptSnapshot
    | { readonly status: ConversationAnswer['status'] }
    | {
        readonly attemptId: string
        readonly delta: string
        readonly policyRevision: number
      }
): string {
  return `id: ${id}\nevent: ${kind}\ndata: ${encodeJson(data)}\n\n`
}

/** Replay expiry always falls back to an authoritative snapshot, never another model call. */
export function observeConversationAttempt<E, R>(
  conversationId: string,
  read: Effect.Effect<AttemptSnapshot, E, R>,
  lastEventId: string | null = null
): Effect.Effect<Response, never, R> {
  type Cursor = {
    readonly text: string
    readonly first: boolean
    readonly done: boolean
    readonly status?: ConversationAnswer['status']
    readonly policyRevision?: number
  }
  return Stream.unfold<Cursor, string, E, R>(
    { text: '', first: true, done: false },
    (cursor) =>
      Effect.gen(function* () {
        if (cursor.done) {
          return
        }
        if (!cursor.first) {
          yield* Effect.sleep('250 millis')
        }
        const snapshot = yield* read
        const { attempt } = snapshot
        const done = attempt.status !== 'Accepted' && attempt.status !== 'Running'
        const id = Encoding.encodeBase64(
          encodeJson([
            conversationId,
            attempt.id,
            snapshot.policyRevision,
            attempt.text.length,
            attempt.status
          ])
        )
        let previous: Cursor | ReturnType<typeof replayPosition> = cursor
        if (cursor.first) {
          previous = replayPosition(lastEventId, conversationId, snapshot)
        }
        let body = ': heartbeat\n\n'
        if (
          previous === undefined ||
          (!cursor.first && cursor.policyRevision !== snapshot.policyRevision)
        ) {
          body =
            event(id, 'snapshot', snapshot) +
            event(id, 'state', { status: attempt.status })
        } else if (!attempt.text.startsWith(previous.text)) {
          body = event(id, 'snapshot', snapshot)
        } else if (attempt.text !== previous.text) {
          body = event(id, 'text', {
            attemptId: attempt.id,
            delta: attempt.text.slice(previous.text.length),
            policyRevision: snapshot.policyRevision
          })
        }
        if (previous !== undefined && previous.status !== attempt.status) {
          body += event(id, 'state', { status: attempt.status })
        }
        if (done) {
          body += event(id, 'terminal', snapshot)
        }
        return [
          body,
          {
            text: attempt.text,
            first: false,
            done,
            status: attempt.status,
            policyRevision: snapshot.policyRevision
          }
        ] satisfies readonly [string, Cursor]
      })
  ).pipe(
    Stream.catch(() =>
      Stream.succeed('event: terminal\ndata: {"error":"access_unavailable"}\n\n')
    ),
    Stream.map((value) => new TextEncoder().encode(value)),
    (stream) => Stream.toReadableStreamEffect(stream),
    Effect.map(
      (body) =>
        new Response(body, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff'
          }
        })
    )
  )
}
