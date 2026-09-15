// Node adapters bundle and launch the real Worker in a local workerd process.
// oxlint-disable effect/noNodeBuiltinImport -- test runtime construction requires local paths
import { workerCompatibility } from '../../../../infra/bindings.ts'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import {
  type RequestInit,
  Miniflare,
  convertV4MiniflareOptions,
  Response as MiniflareResponse
} from 'miniflare'
import { Effect, Schema, Schedule } from 'effect'
import { ConversationPage } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { AssistantReservation } from '@b2b-saas-starter/capabilities/assistant/admission'
import { listMigrations } from '../../../../packages/db/src/migrations-fs.ts'

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))
const decodeHistory = Schema.decodeUnknownEffect(ConversationPage)
const decodeReservations = Schema.decodeUnknownEffect(
  Schema.Array(AssistantReservation)
)
const credential = {
  kind: 'session',
  userId: 'usr_do',
  sessionId: 'ses_do',
  expiresAt: 4_102_444_800_000
}

const bundle = Effect.fn('ConversationHostTest.bundle')(function* () {
  const result = yield* Effect.promise(() =>
    build({
      entryPoints: [join(import.meta.dirname, 'worker.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire('/worker.js');"
      },
      target: 'es2022',
      external: ['cloudflare:*', 'node:*'],
      conditions: ['workerd', 'worker', 'browser'],
      logLevel: 'silent'
    })
  )
  const output = result.outputFiles[0]
  if (output === undefined) {
    return yield* Effect.die('Test Worker bundling produced no output.')
  }
  return output.text
})

/** Real migrated D1 plus the actual SQLite AIChatAgent class. */
export const provisionConversationHost = Effect.fn('ConversationHostTest.provision')(
  function* (configured: boolean, maxInputTokens = 64_000) {
    const script = yield* bundle()
    const requests: Array<string> = []
    const outputs: Array<ReadableStreamDefaultController<Uint8Array>> = []
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'assistant-host-'))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true }))
    )
    const bindings = {
      ASSISTANT_PROVIDER_CONTEXT_TOKENS: '128000',
      ASSISTANT_PROVIDER_OUTPUT_TOKENS: '16000',
      ASSISTANT_INPUT_TOKENS: String(maxInputTokens),
      ASSISTANT_OUTPUT_TOKENS: '16000',
      ASSISTANT_ACTIVE_LIMIT: '3',
      ASSISTANT_RATE_LIMIT: '20',
      OPENAI_API_KEY: configured ? 'local-test-key' : '',
      OPENAI_BASE_URL: configured ? 'https://model.fixture/v1' : ''
    }
    const options = convertV4MiniflareOptions({
      name: 'assistant-host-test',
      modules: true,
      script,
      compatibilityDate: workerCompatibility.date,
      compatibilityFlags: [...workerCompatibility.flags],
      durableObjects: {
        ASSISTANT_CONVERSATIONS: {
          className: 'WorkspaceAssistantConversation',
          useSQLite: true
        }
      },
      d1Databases: { DB: 'assistant-host-db' },
      bindings,
      outboundService: (request) => {
        requests.push(request.url)
        return new MiniflareResponse(
          new ReadableStream<Uint8Array>({
            start(controller) {
              outputs.push(controller)
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      }
    })
    options.unsafeInspectDurableObjects = true
    options.resourcePersistencePath = directory
    options.isolatedResourcePersistencePath = directory
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() => ({ current: new Miniflare(options) })),
      (active) => Effect.promise(() => active.current.dispose())
    )
    let db = yield* Effect.promise(() => runtime.current.getD1Database('DB'))
    const execute = Effect.fn('ConversationHostTest.execute')((sql: string) =>
      Effect.promise(() => db.prepare(sql).run())
    )
    for (const migration of listMigrations()) {
      for (const sql of migration.sql
        .split('--> statement-breakpoint')
        .map((part) => part.trim())
        .filter(Boolean)) {
        yield* execute(sql)
      }
    }
    for (const sql of [
      "INSERT INTO user(id,email,name) VALUES('usr_do','do@fixture.test','DO fixture')",
      "INSERT INTO workspaces(id,name,slug,planId) VALUES('wrk_do','DO fixture','do-fixture','free')",
      "INSERT INTO workspace_members(id,workspaceId,userId,role) VALUES('member_do','wrk_do','usr_do','member')",
      "INSERT INTO session(id,token,userId,expiresAt) VALUES('ses_do','fixture-session-token','usr_do',4102444800)"
    ]) {
      yield* execute(sql)
    }
    const create = Effect.fn('ConversationHostTest.create')((id: string) =>
      Effect.promise(() =>
        db
          .prepare(
            "INSERT INTO assistant_conversations(id,workspace_id,creator_user_id,created_at) VALUES(?,'wrk_do','usr_do','2026-09-15T12:00:00Z')"
          )
          .bind(id)
          .run()
      )
    )
    const request = Effect.fn('ConversationHostTest.request')(function* (
      id: string,
      action: string,
      body?: Schema.Json,
      headers: Record<string, string> = {}
    ) {
      const invocationHeaders = {
        'x-starter-assistant-context': encodeJson({ conversationId: id, credential }),
        ...headers
      }
      const requestOptions: RequestInit = { headers: invocationHeaders }
      if (body !== undefined) {
        requestOptions.method = 'POST'
        requestOptions.body = encodeJson(body)
        requestOptions.headers = {
          ...invocationHeaders,
          'content-type': 'application/json'
        }
      }
      return yield* Effect.promise(() =>
        runtime.current.dispatchFetch(
          `https://test.local/${id}/${action}`,
          requestOptions
        )
      )
    })
    const history = Effect.fn('ConversationHostTest.history')(function* (id: string) {
      const response = yield* request(id, 'history')
      if (!response.ok) {
        return yield* Effect.die(
          `History ${response.status}: ${yield* Effect.promise(() => response.text())}`
        )
      }
      return yield* decodeHistory(yield* Effect.promise(() => response.json()))
    })
    const reservations = Effect.fn('ConversationHostTest.reservations')(() =>
      Effect.promise(() =>
        db
          .prepare(
            'SELECT id, conversation_id AS conversationId, workspace_id AS workspaceId, user_id AS userId, created_at AS createdAt, deadline, committed_at AS committedAt, released_at AS releasedAt FROM assistant_reservations'
          )
          .all()
      ).pipe(Effect.flatMap((result) => decodeReservations(result.results)))
    )
    const waitForRequests = Effect.fn('ConversationHostTest.waitForRequests')(
      (count: number) =>
        Effect.sync(() => requests.length).pipe(
          Effect.repeat({
            while: (length) => length < count,
            schedule: Schedule.spaced('10 millis')
          }),
          Effect.timeout('5 seconds')
        )
    )
    const emit = Effect.fn('ConversationHostTest.emit')((index: number, text: string) =>
      Effect.sync(() => {
        const output = outputs[index]
        if (output === undefined) {
          throw new Error('Provider request has not started.')
        }
        output.enqueue(
          new TextEncoder().encode(
            `data: ${encodeJson({ id: 'provider-fixture', model: 'fixture-model', choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`
          )
        )
      })
    )
    const finish = Effect.fn('ConversationHostTest.finish')(
      (index: number, outputTokens = 3) =>
        Effect.sync(() => {
          const output = outputs[index]
          if (output === undefined) {
            throw new Error('Provider request has not started.')
          }
          output.enqueue(
            new TextEncoder().encode(
              `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":${outputTokens}}}\n\ndata: [DONE]\n\n`
            )
          )
          output.close()
        })
    )
    const terminal = Effect.fn('ConversationHostTest.terminal')((id: string) =>
      history(id).pipe(
        Effect.repeat({
          while: (page) =>
            page.items.some((item) =>
              item.attempts.some(
                (attempt) =>
                  attempt.status === 'Accepted' || attempt.status === 'Running'
              )
            ),
          schedule: Schedule.spaced('20 millis')
        }),
        Effect.timeout('10 seconds')
      )
    )
    const waitForPersistedText = Effect.fn('ConversationHostTest.waitForPersistedText')(
      function* (id: string, text: string) {
        const storage = yield* Effect.promise(() =>
          runtime.current.unsafeGetDurableObjectStorage(
            'assistant-host-test',
            'WorkspaceAssistantConversation',
            { name: encodeJson(['wrk_do', 'usr_do', id]) }
          )
        )
        yield* Effect.promise(() =>
          storage.exec(
            'SELECT 1 FROM cf_agents_stream_blocks WHERE body LIKE ? LIMIT 1',
            `%${text}%`
          )
        ).pipe(
          Effect.repeat({
            while: (rows) => rows.length === 0,
            schedule: Schedule.spaced('20 millis')
          }),
          Effect.timeout('5 seconds')
        )
      }
    )
    const restart = Effect.fn('ConversationHostTest.restart')(function* () {
      yield* Effect.promise(() => runtime.current.dispose())
      runtime.current = new Miniflare(options)
      db = yield* Effect.promise(() => runtime.current.getD1Database('DB'))
    })
    const waitForText = Effect.fn('ConversationHostTest.waitForText')(
      (id: string, text: string) =>
        history(id).pipe(
          Effect.repeat({
            while: (page) => page.items[0]?.attempts[0]?.text !== text,
            schedule: Schedule.spaced('20 millis')
          }),
          Effect.timeout('5 seconds')
        )
    )
    const waitForRelease = reservations().pipe(
      Effect.repeat({
        while: (rows) => rows.some((row) => row.releasedAt === null),
        schedule: Schedule.spaced('20 millis')
      }),
      Effect.timeout('5 seconds')
    )
    return {
      waitForRelease,
      waitForPersistedText,
      create,
      request,
      history,
      reservations,
      requests,
      waitForRequests,
      emit,
      finish,
      terminal,
      restart,
      execute,
      waitForText
    }
  }
)
