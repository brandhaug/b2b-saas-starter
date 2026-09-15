// @vitest-environment node
import { expect, it } from '@effect/vitest'
import { Effect, Fiber, Schedule } from 'effect'
import { nativeObserver } from '../../../test/assistant/native-observer'
import { provisionConversationHost } from '../../../test/assistant/host-harness'

it.live(
  'refuses unconfigured generation without accepting input or reserving quota',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(false)
      yield* host.create('unconfigured')
      const response = yield* host.request('unconfigured', 'send', {
        question: 'Hello',
        idempotencyKey: 'send-1'
      })
      expect(response.status).toBe(503)
      expect(yield* host.reservations()).toHaveLength(0)
      expect((yield* host.history('unconfigured')).items).toHaveLength(0)
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'persists acceptance, joins duplicate delivery, and completes with no observers',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('durable')
      const send = { question: 'Hello', idempotencyKey: 'durable-1' }
      const accepted = yield* host.request('durable', 'send', send)
      expect(accepted.status).toBe(202)
      const beforeOutput = yield* host.history('durable')
      expect(beforeOutput.items).toHaveLength(1)
      expect(beforeOutput.items[0]?.attempts).toHaveLength(1)
      const reservations = yield* host.reservations()
      expect(reservations).toHaveLength(1)
      expect(reservations[0]?.committedAt).not.toBeNull()
      expect((yield* host.request('durable', 'send', send)).status).toBe(200)
      expect(
        (yield* host.request('durable', 'send', {
          question: 'Other',
          idempotencyKey: 'other'
        })).status
      ).toBe(409)
      yield* host.waitForRequests(1)
      yield* host.emit(0, 'Fixture answer')
      yield* host.finish(0)
      const completed = yield* host.terminal('durable')
      expect(completed.items[0]?.attempts[0]).toMatchObject({
        status: 'Completed',
        text: 'Fixture answer',
        provider: 'openai-compatible',
        modelId: 'fixture-model',
        inputTokens: 11,
        outputTokens: 3
      })
      expect(host.requests).toHaveLength(1)
      expect((yield* host.reservations())[0]?.releasedAt).not.toBeNull()
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'enforces the shared three-run ceiling across four conversation objects',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      for (const id of ['one', 'two', 'three', 'four']) {
        yield* host.create(id)
      }
      for (const id of ['one', 'two', 'three']) {
        expect(
          (yield* host.request(id, 'send', { question: id, idempotencyKey: id })).status
        ).toBe(202)
      }
      expect(
        (yield* host.request('four', 'send', {
          question: 'four',
          idempotencyKey: 'four'
        })).status
      ).toBe(429)
      expect((yield* host.history('four')).items).toHaveLength(0)
      expect(yield* host.reservations()).toHaveLength(3)
      yield* host.waitForRequests(3)
      for (const index of [0, 1, 2]) {
        yield* host.emit(index, 'Answer')
        yield* host.finish(index)
      }
      for (const id of ['one', 'two', 'three']) {
        yield* host.terminal(id)
      }
      expect(host.requests).toHaveLength(3)
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'keeps Stop terminal when provider completion races, and joins Stop repeats',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('stop')
      yield* host.request('stop', 'send', {
        question: 'Hello',
        idempotencyKey: 'stop-send'
      })
      yield* host.waitForRequests(1)
      yield* host.emit(0, 'Partial answer')
      const page = yield* host.waitForText('stop', 'Partial answer')
      const attemptId = page.items[0]?.attempts[0]?.id
      if (attemptId === undefined) {
        return yield* Effect.die('Accepted attempt is absent.')
      }
      const stopped = yield* host.request('stop', 'stop', { attemptId })
      expect(stopped.status).toBe(200)
      expect((yield* host.terminal('stop')).items[0]?.attempts[0]).toMatchObject({
        status: 'Stopped',
        text: 'Partial answer'
      })
      expect((yield* host.request('stop', 'stop', { attemptId })).status).toBe(200)
      yield* host.restart()
      expect((yield* host.history('stop')).items[0]?.attempts[0]).toMatchObject({
        status: 'Stopped',
        text: 'Partial answer'
      })
      expect(host.requests).toHaveLength(1)
      expect((yield* host.reservations())[0]?.releasedAt).not.toBeNull()
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'returns an authoritative snapshot for an expired replay cursor after observer disconnect',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('observe')
      yield* host.request('observe', 'send', {
        question: 'Hello',
        idempotencyKey: 'observe-send'
      })
      yield* host.waitForRequests(1)
      const attemptId = (yield* host.history('observe')).items[0]?.attempts[0]?.id
      if (attemptId === undefined) {
        return yield* Effect.die('Accepted attempt is absent.')
      }
      const observation = yield* host.request(
        'observe',
        `events?attemptId=${attemptId}`
      )
      expect(observation.status).toBe(200)
      const reader = observation.body?.getReader()
      if (reader === undefined) {
        return yield* Effect.die('SSE observation has no stream.')
      }
      const first = yield* Effect.promise(() => reader.read())
      expect(new TextDecoder().decode(first.value)).toContain('event: snapshot')
      yield* Effect.promise(() => reader.cancel())
      yield* host.emit(0, 'After disconnect')
      yield* host.finish(0)
      yield* host.terminal('observe')
      const reconnect = yield* host.request(
        'observe',
        `events?attemptId=${attemptId}`,
        undefined,
        { 'last-event-id': 'expired-cursor' }
      )
      const replay = yield* Effect.promise(() => reconnect.text())
      expect(replay).toContain('event: snapshot')
      expect(replay).toContain('After disconnect')
      expect(replay).toContain('Completed')
      expect(host.requests).toHaveLength(1)
    }).pipe(Effect.scoped),
  120_000
)

for (const partial of [false, true]) {
  it.live(
    `interrupts a restarted object ${partial ? 'during output' : 'before output'} without new inference`,
    () =>
      Effect.gen(function* () {
        const host = yield* provisionConversationHost(true)
        yield* host.create('restart')
        yield* host.request('restart', 'send', {
          question: 'Hello',
          idempotencyKey: 'restart-send'
        })
        yield* host.waitForRequests(1)
        if (partial) {
          yield* host.emit(0, 'Durable partial')
          for (let chunk = 0; chunk < 10; chunk += 1) {
            yield* host.emit(0, '.')
          }
          yield* host.waitForPersistedText('restart', 'Durable partial')
        }
        yield* host.restart()
        const recovered = yield* host.terminal('restart').pipe(
          Effect.repeat({
            while: (page) =>
              partial && !page.items[0]?.attempts[0]?.text.includes('Durable partial'),
            schedule: Schedule.spaced('20 millis')
          }),
          Effect.timeout('5 seconds')
        )
        expect(recovered.items[0]?.attempts[0]?.status).toBe('Interrupted')
        if (partial) {
          expect(
            recovered.items[0]?.attempts[0]?.text.split('Durable partial')
          ).toHaveLength(2)
        }
        expect(host.requests).toHaveLength(1)
        expect(
          (yield* host.request('restart', 'send', {
            question: 'Hello',
            idempotencyKey: 'restart-send'
          })).status
        ).toBe(200)
        expect(yield* host.reservations()).toHaveLength(1)
      }).pipe(Effect.scoped),
    120_000
  )
}

it.live(
  'interrupts generation when membership is revoked and withholds history',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('revoked')
      yield* host.request('revoked', 'send', {
        question: 'Hello',
        idempotencyKey: 'revoked-send'
      })
      yield* host.waitForRequests(1)
      yield* host.emit(0, 'Visible before revocation')
      yield* host.waitForText('revoked', 'Visible before revocation')
      yield* host.execute("DELETE FROM workspace_members WHERE id = 'member_do'")
      expect((yield* host.request('revoked', 'history')).status).toBe(404)
      yield* host.emit(0, 'Hidden after revocation')
      yield* host.finish(0)
      yield* host.waitForRelease
      yield* host.execute(
        "INSERT INTO workspace_members(id,workspaceId,userId,role) VALUES('member_do','wrk_do','usr_do','member')"
      )
      const terminal = yield* host.terminal('revoked')
      expect(terminal.items[0]?.attempts[0]?.status).toBe('Interrupted')
      expect(terminal.items[0]?.attempts[0]?.text).not.toContain(
        'Hidden after revocation'
      )
      expect(host.requests).toHaveLength(1)
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'honors the deletion fence and physically clears a running conversation',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('deleted')
      yield* host.request('deleted', 'send', {
        question: 'Hello',
        idempotencyKey: 'deleted-send'
      })
      yield* host.waitForRequests(1)
      yield* host.emit(0, 'Private answer')
      yield* host.waitForText('deleted', 'Private answer')
      yield* host.execute(
        "UPDATE assistant_conversations SET deleted_at = '2026-09-15T12:01:00Z' WHERE id = 'deleted'"
      )
      expect((yield* host.request('deleted', 'history')).status).toBe(404)
      expect(
        (yield* host.request(
          'deleted',
          'cleanup',
          {},
          { 'x-starter-assistant-cleanup': 'deleted' }
        )).status
      ).toBe(204)
      yield* host.restart()
      expect(
        (yield* host.request(
          'deleted',
          'cleanup',
          {},
          { 'x-starter-assistant-cleanup': 'deleted' }
        )).status
      ).toBe(204)
      expect((yield* host.request('deleted', 'history')).status).toBe(404)
      expect(host.requests).toHaveLength(1)
      expect((yield* host.reservations())[0]?.releasedAt).not.toBeNull()
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'gates native socket snapshots and refuses generation, clear, and RPC bypass frames',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('native')
      const observer = yield* nativeObserver(
        yield* host.request('native', 'connect', undefined, { upgrade: 'websocket' })
      )
      yield* observer.waitForFrame('conversation_snapshot')
      for (const type of [
        'cf_agent_use_chat_request',
        'cf_agent_chat_clear',
        'cf_agent_chat_messages',
        'rpc'
      ]) {
        yield* observer.send({
          type,
          id: 'bypass',
          method: 'saveMessages',
          body: {
            messages: [
              {
                id: 'forged',
                role: 'user',
                parts: [{ type: 'text', text: 'Generate now' }]
              }
            ]
          }
        })
      }
      // A subsequent accepted operation proves bypass frames did not occupy the host.
      expect(
        (yield* host.request('native', 'send', {
          question: 'Authorized',
          idempotencyKey: 'authorized'
        })).status
      ).toBe(202)
      yield* host.waitForRequests(1)
      yield* host.emit(0, 'Visible answer')
      yield* host.finish(0)
      yield* host.terminal('native')
      yield* observer.waitForFrame('Visible answer')
      expect(host.requests).toHaveLength(1)
      expect((yield* host.history('native')).items).toHaveLength(1)
      expect(observer.frames.join('\n')).not.toContain('Generate now')
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'closes a native observer after revocation before disclosing more content',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('socket-revoked')
      const observer = yield* nativeObserver(
        yield* host.request('socket-revoked', 'connect', undefined, {
          upgrade: 'websocket'
        })
      )
      yield* observer.waitForFrame('conversation_snapshot')
      yield* host.execute("DELETE FROM workspace_members WHERE id = 'member_do'")
      yield* observer.send({ type: 'cf_agent_stream_resume_request' })
      expect(yield* observer.waitForClose).toBe(1008)
      expect(
        observer.frames.filter((frame) => frame.includes('conversation_snapshot'))
      ).toHaveLength(1)
      expect(host.requests).toHaveLength(0)
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'rejects a current request above its input budget before reservation',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true, 128)
      yield* host.create('over-budget')
      const response = yield* host.request('over-budget', 'send', {
        question: 'Hello',
        idempotencyKey: 'over-budget'
      })
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.json())).toEqual({
        _tag: 'ConversationInputRejected',
        reason: 'current_context_budget'
      })
      expect(yield* host.reservations()).toHaveLength(0)
      expect((yield* host.history('over-budget')).items).toHaveLength(0)
      expect(host.requests).toHaveLength(0)
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'redacts storage diagnostics from public failures',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(false)
      yield* host.create('storage-failure')
      yield* host.execute('DROP TABLE assistant_conversations')
      const response = yield* host.request('storage-failure', 'history')
      expect(response.status).toBe(503)
      const body = yield* Effect.promise(() => response.text())
      expect(body).not.toContain('Failed query')
      expect(body).not.toContain('assistant_conversations')
      expect(body).not.toContain('storage-failure')
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'settles a concurrent Stop and provider completion once',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('race')
      yield* host.request('race', 'send', {
        question: 'Hello',
        idempotencyKey: 'race-send'
      })
      yield* host.waitForRequests(1)
      yield* host.emit(0, 'Racing answer')
      const attemptId = (yield* host.waitForText('race', 'Racing answer')).items[0]
        ?.attempts[0]?.id
      if (attemptId === undefined) {
        return yield* Effect.die('Accepted attempt is absent.')
      }
      yield* Effect.all([host.request('race', 'stop', { attemptId }), host.finish(0)], {
        concurrency: 'unbounded'
      })
      const settled = (yield* host.terminal('race')).items[0]?.attempts[0]
      expect(['Stopped', 'Completed']).toContain(settled?.status)
      yield* host.request('race', 'stop', { attemptId })
      expect((yield* host.terminal('race')).items[0]?.attempts[0]?.status).toBe(
        settled?.status
      )
      expect(host.requests).toHaveLength(1)
      expect((yield* host.reservations())[0]?.releasedAt).not.toBeNull()
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'withholds the initial native snapshot from an invalid session',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('invalid-socket')
      for (const invalid of [
        { sessionId: 'missing-session', expiresAt: 4_102_444_800_000, status: 404 },
        { sessionId: 'ses_do', expiresAt: 1, status: 401 }
      ]) {
        const invalidCredential = JSON.stringify({
          conversationId: 'invalid-socket',
          credential: {
            kind: 'session',
            userId: 'usr_do',
            sessionId: invalid.sessionId,
            expiresAt: invalid.expiresAt
          }
        })
        const response = yield* host.request('invalid-socket', 'connect', undefined, {
          upgrade: 'websocket',
          'x-starter-assistant-context': invalidCredential
        })
        expect(response.status).toBe(invalid.status)
        expect(response.webSocket).toBeNull()
      }
      expect(host.requests).toHaveLength(0)
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'invalidates a native observer when required permissions become stricter',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('policy-socket')
      const observer = yield* nativeObserver(
        yield* host.request('policy-socket', 'connect', undefined, {
          upgrade: 'websocket'
        })
      )
      yield* observer.waitForFrame('conversation_snapshot')
      yield* host.execute(
        `UPDATE assistant_conversations SET required_permissions = '["assistant:read","webhook:list"]', policy_revision = policy_revision + 1 WHERE id = 'policy-socket'`
      )
      yield* observer.send({ type: 'cf_agent_stream_resume_request' })
      expect(yield* observer.waitForClose).toBe(1008)
      expect(
        observer.frames.filter((frame) => frame.includes('conversation_snapshot'))
      ).toHaveLength(1)
      expect(host.requests).toHaveLength(0)
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'holds admission until stopped output finishes saving and keeps retry output separate',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('finalization')
      const send = { question: 'Hello', idempotencyKey: 'first-send' }
      yield* host.request('finalization', 'send', send)
      yield* host.waitForRequests(1)
      yield* host.emit(0, 'Stopped prefix')
      const page = yield* host.waitForText('finalization', 'Stopped prefix')
      const attemptId = page.items[0]?.attempts[0]?.id
      if (attemptId === undefined) {
        return yield* Effect.die('Accepted attempt is absent.')
      }
      yield* host.request('finalization', 'pause-persistence', {})
      const stopping = yield* host
        .request('finalization', 'stop', { attemptId })
        .pipe(Effect.forkChild)
      yield* host.request('finalization', 'persistence-waiting').pipe(
        Effect.repeat({
          while: (response) => response.status !== 204,
          schedule: Schedule.spaced('10 millis')
        }),
        Effect.timeout('5 seconds')
      )
      expect((yield* host.request('finalization', 'send', send)).status).toBe(200)
      expect(
        (yield* host.request('finalization', 'send', {
          question: 'Distinct',
          idempotencyKey: 'distinct'
        })).status
      ).toBe(409)
      const retry = { attemptId, idempotencyKey: 'retry' }
      expect((yield* host.request('finalization', 'retry', retry)).status).toBe(409)
      expect(host.requests).toHaveLength(1)
      yield* host.request('finalization', 'release-persistence', {})
      expect((yield* Fiber.join(stopping)).status).toBe(200)
      expect((yield* host.request('finalization', 'retry', retry)).status).toBe(202)
      yield* host.waitForRequests(2)
      yield* host.emit(1, 'New answer')
      yield* host.finish(1)
      const completed = yield* host.terminal('finalization')
      expect(completed.items[0]?.attempts).toMatchObject([
        { id: attemptId, status: 'Stopped', text: 'Stopped prefix' },
        { status: 'Completed', text: 'New answer' }
      ])
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'keeps delivering to a surviving tab when another observer disconnects during output',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('disconnect-tabs')
      const leaving = yield* nativeObserver(
        yield* host.request('disconnect-tabs', 'connect', undefined, {
          upgrade: 'websocket'
        })
      )
      const staying = yield* nativeObserver(
        yield* host.request('disconnect-tabs', 'connect', undefined, {
          upgrade: 'websocket'
        })
      )
      yield* leaving.waitForFrame('conversation_snapshot')
      yield* staying.waitForFrame('conversation_snapshot')
      yield* host.request('disconnect-tabs', 'send', {
        question: 'Continue after leaving',
        idempotencyKey: 'disconnect-tabs'
      })
      yield* host.waitForRequests(1)
      yield* host.emit(0, 'Before disconnect. ')
      yield* leaving.waitForFrame('Before disconnect.')
      yield* host.emit(0, 'Queued output. ')
      yield* leaving.close
      yield* host.emit(0, 'After disconnect.')
      yield* host.finish(0)
      yield* staying.waitForFrame('After disconnect.')
      yield* staying.waitForFrame('Completed')
      expect(
        (yield* host.terminal('disconnect-tabs')).items[0]?.attempts[0]
      ).toMatchObject({
        status: 'Completed',
        text: 'Before disconnect. Queued output. After disconnect.'
      })
      expect(host.requests).toHaveLength(1)
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'preserves an output-limit reason when provider usage exceeds the cap with a stop finish',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('output-cap')
      yield* host.request('output-cap', 'send', {
        question: 'Answer',
        idempotencyKey: 'output-cap'
      })
      yield* host.waitForRequests(1)
      yield* host.emit(0, 'Saved prefix')
      yield* host.finish(0, 16_001)
      expect((yield* host.terminal('output-cap')).items[0]?.attempts[0]).toMatchObject({
        status: 'Interrupted',
        reason: 'output_limit',
        text: 'Saved prefix',
        finishReason: 'stop',
        outputTokens: 16_001
      })
    }).pipe(Effect.scoped),
  120_000
)

it.live(
  'closes an existing SSE observation across membership removal and rejoin',
  () =>
    Effect.gen(function* () {
      const host = yield* provisionConversationHost(true)
      yield* host.create('sse-restoration')
      yield* host.request('sse-restoration', 'send', {
        question: 'Explain safely',
        idempotencyKey: 'before-revocation'
      })
      yield* host.waitForRequests(1)
      yield* host.emit(0, 'Saved prefix')
      const attemptId = (yield* host.history('sse-restoration')).items[0]?.attempts[0]
        ?.id
      if (attemptId === undefined) {
        return yield* Effect.die('Accepted attempt is absent.')
      }
      const response = yield* host.request(
        'sse-restoration',
        `events?attemptId=${attemptId}`
      )
      const reader = response.body?.getReader()
      if (reader === undefined) {
        return yield* Effect.die('SSE observation has no stream.')
      }
      const first = yield* Effect.promise(() => reader.read())
      expect(new TextDecoder().decode(first.value)).toContain('event: snapshot')
      yield* host.execute("DELETE FROM workspace_members WHERE id='member_do'")
      yield* host.execute(
        "INSERT INTO workspace_members(id,workspaceId,userId,role) VALUES('member_do','wrk_do','usr_do','member')"
      )
      yield* host.emit(0, 'Forbidden continuation')
      const remainder = yield* Effect.gen(function* () {
        let text = ''
        let chunk = yield* Effect.promise(() => reader.read())
        while (!chunk.done) {
          text += new TextDecoder().decode(chunk.value)
          chunk = yield* Effect.promise(() => reader.read())
        }
        return text
      }).pipe(Effect.timeout('5 seconds'))
      expect(remainder).toContain('access_unavailable')
      expect(remainder).not.toContain('Forbidden continuation')
      yield* host.terminal('sse-restoration')
      const fresh = yield* host.request(
        'sse-restoration',
        `events?attemptId=${attemptId}`
      )
      expect(yield* Effect.promise(() => fresh.text())).toContain('Interrupted')
      expect(host.requests).toHaveLength(1)
    }).pipe(Effect.scoped),
  120_000
)

for (const change of [
  {
    name: 'membership removal and rejoin',
    sql: [
      "DELETE FROM workspace_members WHERE id='member_do'",
      "INSERT INTO workspace_members(id,workspaceId,userId,role) VALUES('member_do','wrk_do','usr_do','member')"
    ]
  },
  {
    name: 'role change and restoration',
    sql: [
      "UPDATE workspace_members SET role='admin' WHERE id='member_do'",
      "UPDATE workspace_members SET role='member' WHERE id='member_do'"
    ]
  },
  {
    name: 'workspace suspension and restoration',
    sql: [
      "UPDATE workspaces SET suspensionStatus='suspended' WHERE id='wrk_do'",
      "UPDATE workspaces SET suspensionStatus='active' WHERE id='wrk_do'"
    ]
  }
]) {
  it.live(
    `requires fresh observation and explicit Retry after rapid ${change.name}`,
    () =>
      Effect.gen(function* () {
        const host = yield* provisionConversationHost(true)
        yield* host.create('rapid-restoration')
        const observer = yield* nativeObserver(
          yield* host.request('rapid-restoration', 'connect', undefined, {
            upgrade: 'websocket'
          })
        )
        yield* observer.waitForFrame('conversation_snapshot')
        yield* host.request('rapid-restoration', 'send', {
          question: 'Explain safely',
          idempotencyKey: 'before-revocation'
        })
        yield* host.waitForRequests(1)
        yield* host.emit(0, 'Saved before revocation')
        yield* observer.waitForFrame('Saved before revocation')
        // No host notification is delivered: the durable fence must survive this missed window.
        for (const sql of change.sql) {
          yield* host.execute(sql)
        }
        yield* host.emit(0, 'Forbidden continuation')
        const interrupted = yield* host.terminal('rapid-restoration')
        expect(interrupted.items[0]?.attempts[0]).toMatchObject({
          status: 'Interrupted',
          reason: 'authority',
          text: 'Saved before revocation'
        })
        // Local workerd can defer TCP teardown after exchanging Close frames.
        // Verify the host has closed observation before any fresh connection joins.
        const observation = yield* host
          .request('rapid-restoration', 'observers-open')
          .pipe(
            Effect.repeat({
              while: (response) => response.status === 204,
              schedule: Schedule.spaced('10 millis')
            }),
            Effect.timeout('5 seconds')
          )
        expect(observation.status).toBe(404)
        expect(observer.frames.join('')).not.toContain('Forbidden continuation')
        expect(host.requests).toHaveLength(1)
        const fresh = yield* nativeObserver(
          yield* host.request('rapid-restoration', 'connect', undefined, {
            upgrade: 'websocket'
          })
        )
        yield* fresh.waitForFrame('Interrupted')
        const attemptId = interrupted.items[0]?.attempts[0]?.id
        if (attemptId === undefined) {
          return yield* Effect.die('Missing interrupted attempt')
        }
        expect(
          (yield* host.request('rapid-restoration', 'retry', {
            attemptId,
            idempotencyKey: 'after-restoration'
          })).status
        ).toBe(202)
        yield* host.waitForRequests(2)
        yield* host.emit(1, 'Fresh answer')
        yield* host.finish(1)
        const completed = yield* host.terminal('rapid-restoration')
        expect(completed.items[0]?.attempts.map((attempt) => attempt.status)).toEqual([
          'Interrupted',
          'Completed'
        ])
        expect(host.requests).toHaveLength(2)
      }).pipe(Effect.scoped),
    120_000
  )
}
