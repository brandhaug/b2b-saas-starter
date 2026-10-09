import {
  applyD1Migrations,
  runDurableObjectAlarm,
  runInDurableObject
} from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { Effect, Schedule, Schema } from 'effect'
import { vi, type ExpectStatic } from 'vite-plus/test'
import { ConversationPage } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { type WorkspaceAssistantConversation } from '../../src/lib/assistant/conversation-host'

const instances = new WeakMap<WorkspaceAssistantConversation, string>()
const decodeHistory = Schema.decodeUnknownEffect(ConversationPage)

export const provisionLifecycleHost = Effect.fn('LifecycleTest.provision')(function* (
  id: string,
  expect: ExpectStatic
) {
  const db = env.DB
  const namespace = env.ASSISTANT_CONVERSATIONS
  const migrations = env.TEST_MIGRATIONS
  if (db === undefined || namespace === undefined || migrations === undefined) {
    return yield* Effect.die('Lifecycle pool bindings are absent')
  }
  yield* Effect.promise(() => applyD1Migrations(db, migrations))
  for (const sql of [
    "INSERT OR IGNORE INTO user(id,email,name) VALUES('usr_do','do@fixture.test','DO fixture')",
    "INSERT OR IGNORE INTO workspaces(id,name,slug,planId) VALUES('wrk_do','DO fixture','do-fixture','free')",
    "INSERT OR IGNORE INTO workspace_members(id,workspaceId,userId,role) VALUES('member_do','wrk_do','usr_do','member')",
    "INSERT OR IGNORE INTO session(id,token,userId,expiresAt) VALUES('ses_do','fixture-session-token','usr_do',4102444800)"
  ]) {
    yield* Effect.promise(() => db.prepare(sql).run())
  }
  yield* Effect.promise(() =>
    db
      .prepare(
        "INSERT INTO assistant_conversations(id,workspace_id,creator_user_id,created_at) VALUES(?,'wrk_do','usr_do','2026-09-15T12:00:00Z')"
      )
      .bind(id)
      .run()
  )
  let requests = 0
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        const request = new Request(input, init)
        if (
          request.url !== 'https://model.fixture/v1/chat/completions' ||
          request.method !== 'POST'
        ) {
          return Promise.resolve(
            new Response('Unexpected fixture request', { status: 502 })
          )
        }
        requests += 1
        return Promise.resolve(
          new Response(
            'data: {"id":"fixture","model":"fixture-model","choices":[{"delta":{"content":"Saved lifecycle answer"},"finish_reason":null}]}\n\n' +
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } }
          )
        )
      })
    ),
    (spy) => Effect.sync(() => spy.mockRestore())
  )
  const stub = namespace.get(
    namespace.idFromName(JSON.stringify(['wrk_do', 'usr_do', id]))
  )
  const headers = {
    'content-type': 'application/json',
    'x-starter-assistant-context': JSON.stringify({
      conversationId: id,
      credential: {
        kind: 'session',
        userId: 'usr_do',
        sessionId: 'ses_do',
        expiresAt: 4_102_444_800_000
      }
    })
  }
  const send = Effect.fn('LifecycleTest.send')(() =>
    Effect.promise(() =>
      stub.fetch('https://test.local/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: 'Hello', idempotencyKey: id })
      })
    ).pipe(Effect.tap((response) => Effect.promise(() => response.text())))
  )
  const history = Effect.fn('LifecycleTest.history')(() =>
    Effect.promise(() => stub.fetch('https://test.local/history', { headers })).pipe(
      Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(200))),
      Effect.flatMap((response) => Effect.promise(() => response.json())),
      Effect.flatMap(decodeHistory)
    )
  )
  const evidence = Effect.fn('LifecycleTest.evidence')(() =>
    Effect.promise(() =>
      runInDurableObject<
        WorkspaceAssistantConversation,
        {
          instance: string
          schedules: Awaited<
            ReturnType<WorkspaceAssistantConversation['listSchedules']>
          >
          alarm: number | null
          connections: number
        }
      >(stub, (instance, state) => {
        const identity = instances.get(instance) ?? crypto.randomUUID()
        instances.set(instance, identity)
        return Promise.all([instance.listSchedules(), state.storage.getAlarm()]).then(
          ([schedules, alarm]) => ({
            instance: identity,
            schedules,
            alarm,
            connections: [...instance.getConnections()].length
          })
        )
      })
    )
  )
  const runDueAlarm = Effect.fn('LifecycleTest.runDueAlarm')(function* () {
    const { schedules } = yield* evidence()
    expect(schedules).toHaveLength(1)
    const due = schedules[0]?.time
    if (due === undefined) {
      return yield* Effect.die('Authority schedule missing')
    }
    // The helper runs the alarm immediately but the SDK still checks the job's due time.
    yield* Effect.acquireUseRelease(
      Effect.sync(() => vi.spyOn(Date, 'now').mockReturnValue(due * 1000 + 1)),
      () =>
        Effect.promise(() => runDurableObjectAlarm(stub)).pipe(
          Effect.tap((ran) => Effect.sync(() => expect(ran).toBe(true)))
        ),
      (clock) => Effect.sync(() => clock.mockRestore())
    )
  })
  const complete = Effect.fn('LifecycleTest.complete')(function* () {
    expect((yield* send()).status).toBe(202)
    const page = yield* history().pipe(
      Effect.repeat({
        while: (current) => current.items[0]?.attempts[0]?.status !== 'Completed',
        schedule: Schedule.spaced('10 millis')
      }),
      Effect.timeout('10 seconds')
    )
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.attempts).toHaveLength(1)
    expect(page.items[0]?.attempts[0]).toMatchObject({
      status: 'Completed',
      text: 'Saved lifecycle answer'
    })
    return page
  })
  const reservations = Effect.fn('LifecycleTest.reservations')(() =>
    Effect.promise(() =>
      db
        .prepare('SELECT * FROM assistant_reservations WHERE conversation_id = ?')
        .bind(id)
        .all()
    ).pipe(Effect.map((result) => result.results))
  )
  return {
    stub,
    send,
    history,
    evidence,
    runDueAlarm,
    complete,
    reservations,
    providerRequests: () => requests
  }
})
