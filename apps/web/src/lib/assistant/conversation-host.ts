import {
  AIChatAgent,
  type ChatRecoveryContext,
  type OnChatMessageOptions
} from '@cloudflare/ai-chat'
import { type AgentContext, type Connection } from 'agents'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage
} from 'ai'
import { DateTime, Effect, Layer, ManagedRuntime, Stream, Semaphore } from 'effect'
import {
  WideEventLoggerLive,
  withHttpInvocation,
  withTriggerScope,
  makeOtlpLayer
} from '@b2b-saas-starter/logger'
import { recordConversationOutcome } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-observability'
import { type CapabilityServices } from '@b2b-saas-starter/capabilities/layers'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { AssistantDirectory } from '@b2b-saas-starter/capabilities/assistant/directory'
import { AssistantAdmission } from '@b2b-saas-starter/capabilities/assistant/admission'
import { AssistantAuthority } from '@b2b-saas-starter/capabilities/developer-platform/assistant-authority'
import {
  acceptConversationAnswer,
  ConversationExecution as Execution
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-admission'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import {
  activeConversationAttempt,
  type ConversationSend,
  type ConversationRetry,
  ConversationNotFound,
  ConversationUnavailable,
  conversationTitle,
  conversationHistoryPage,
  type ConversationAttempt
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import {
  ConversationModel,
  selectConversationModelLayer
} from '@b2b-saas-starter/ai/conversation'
import { ConversationLedger } from './conversation-ledger'
import { observeConversationAttempt } from './conversation-events'
import { conversationLimits } from './conversation-config'
import {
  allowedConversationRequest,
  decodeConnectionState,
  decodeInvocation,
  decodeObservation,
  decodeFrame,
  decodeStop,
  decodeSend,
  decodeRetry,
  decodeFailure,
  failureResponse
} from './conversation-protocol'

const InvocationHeader = 'x-starter-assistant-context'

type ConversationRun = {
  readonly attemptId: string
  readonly controller: AbortController
  text: string
  completion?: Promise<void>
  settled: boolean
}

function savedText(messages: ReadonlyArray<UIMessage>, id: string): string {
  return (
    messages
      .find((message) => message.id === id)
      ?.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('') ?? ''
  )
}

/** The exported host owns SDK persistence/replay; every SDK entry and disclosure is gated here. */
export class WorkspaceAssistantConversation extends AIChatAgent<Env> {
  private readonly ledger: ConversationLedger
  private readonly runtime: ReturnType<
    typeof ManagedRuntime.make<CapabilityServices, never>
  >
  private recoveryAttemptId: string | undefined
  private run: ConversationRun | undefined
  private readonly admission = Semaphore.makeUnsafe(1)
  private disclosurePending = false
  private disclosures: Array<{
    connection: Connection
    data: string
    send: (data: string) => void
  }> = []

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env)
    this.ledger = new ConversationLedger(ctx.storage)
    this.runtime = ManagedRuntime.make(
      Layer.merge(
        selectCapabilitiesLayer({
          DB: env.DB,
          assistantResource: env.ASSISTANT_RESOURCE_URL
        }),
        WideEventLoggerLive
      )
    )
    const fetch = this.fetch.bind(this)
    this.fetch = (request) => {
      if (!allowedConversationRequest(request)) {
        return this.runtime.runPromise(
          Effect.succeed(new Response(null, { status: 404 }))
        )
      }
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return fetch(request)
      }
      return this.respond(
        request,
        Effect.gen({ self: this }, function* () {
          const invocation = yield* this.invocation(request)
          yield* this.authorize(invocation.credential, 'read')
          return yield* Effect.tryPromise({
            try: () => fetch(request),
            catch: () => new ConversationUnavailable({ reason: 'storage' })
          })
        })
      )
    }
    const connect = this.onConnect.bind(this)
    const message = this.onMessage.bind(this)
    // AIChatAgent installs native protocol wrappers in super(). Replace the outer HTTP gate.
    this.onRequest = (request) => this.respond(request, this.handle(request))
    this.onConnect = (connection, context) =>
      this.runtime
        .runPromise(
          Effect.gen({ self: this }, function* () {
            const invocation = yield* this.invocation(context.request)
            const { row } = yield* this.authorize(invocation.credential, 'read')
            connection.setState({
              credential: invocation.credential,
              runAccessRevision: row.runAccessRevision
            })
            this.guardSend(connection)
            yield* Effect.tryPromise({
              try: async () => {
                await connect(connection, context)
              },
              catch: () => new ConversationUnavailable({ reason: 'storage' })
            })
            connection.send(
              JSON.stringify({
                type: 'conversation_snapshot',
                history: yield* this.history(invocation.credential, null)
              })
            )
            yield* this.watchAuthority()
          })
        )
        .catch(() => {
          connection.close(1008, 'Access unavailable')
        })
    this.onMessage = (connection, frame) =>
      this.runtime
        .runPromise(
          Effect.gen({ self: this }, function* () {
            this.guardSend(connection)
            yield* this.authorizeObserver(connection)
            const allowed = decodeObservation(frame)
            if (allowed._tag === 'Failure') {
              return
            }
            yield* Effect.tryPromise({
              try: async () => {
                await message(connection, frame)
              },
              catch: () => new ConversationUnavailable({ reason: 'storage' })
            })
          })
        )
        .catch(() => {
          connection.close(1008, 'Access unavailable')
        })
  }

  private invocation(request: Request) {
    return decodeInvocation(request.headers.get(InvocationHeader)).pipe(
      Effect.mapError(() => new ConversationNotFound()),
      Effect.tap((value) => this.ledger.bind(value.conversationId)),
      Effect.flatMap((value) =>
        this.ledger
          .identity()
          .pipe(
            Effect.flatMap((id) =>
              id === value.conversationId
                ? Effect.succeed(value)
                : Effect.fail(new ConversationNotFound())
            )
          )
      )
    )
  }

  private authorize(
    credential: AssistantCredentialReference,
    operation: 'read' | 'write',
    attempt?: ConversationAttempt,
    runAccessRevision?: number
  ) {
    return Effect.gen({ self: this }, function* () {
      const id = yield* this.ledger.identity()
      const directory = yield* AssistantDirectory
      const row = id === null ? null : yield* directory.get(id)
      if (row?.deletedAt !== null) {
        return yield* new ConversationNotFound()
      }
      if (attempt !== undefined && row.runAccessRevision !== runAccessRevision) {
        return yield* new ConversationUnavailable({ reason: 'authority' })
      }
      const authority = yield* AssistantAuthority
      const context = yield* authority.authorize({
        credential,
        workspaceId: row.workspaceId,
        creatorUserId: row.creatorUserId,
        requiredPermissions: row.requiredPermissions,
        operation,
        ...(attempt === undefined
          ? { mode: 'observe' satisfies 'observe' }
          : {
              mode: 'run' satisfies 'run',
              acceptedAt: Date.parse(attempt.createdAt),
              deadline: attempt.deadline
            })
      })
      return { row, context }
    })
  }

  private authorizeObserver(connection: Connection) {
    return Effect.gen({ self: this }, function* () {
      const observation = yield* decodeConnectionState(connection.state)
      const authorized = yield* this.authorize(observation.credential, 'read')
      if (authorized.row.runAccessRevision !== observation.runAccessRevision) {
        return yield* new ConversationUnavailable({ reason: 'authority' })
      }
      return authorized
    })
  }

  private guardSend(connection: Connection) {
    if (this.guarded.has(connection)) {
      return
    }
    this.guarded.add(connection)
    const send = connection.send.bind(connection)
    connection.send = (data) => {
      if (connection.readyState !== WebSocket.OPEN) {
        return
      }
      const frame = decodeFrame(data)
      if (frame._tag === 'Failure') {
        connection.close(1003, 'Unsupported response')
        return
      }
      this.disclosures.push({ connection, data: frame.success, send })
      this.flushDisclosures()
    }
  }
  private readonly guarded = new WeakSet<Connection>()

  private flushDisclosures() {
    if (this.disclosurePending) {
      return
    }
    this.disclosurePending = true
    const flush = this.runtime
      .runPromise(
        Effect.gen({ self: this }, function* () {
          yield* Effect.sleep('10 millis')
          const batch = this.disclosures
          this.disclosures = []
          const groups = new Map<string, typeof batch>()
          for (const frame of batch) {
            const key = JSON.stringify(frame.connection.state)
            const group = groups.get(key) ?? []
            group.push(frame)
            groups.set(key, group)
          }
          // One current check per credential per batch, shared by tabs. Never cache across batches.
          for (const group of groups.values()) {
            yield* Effect.gen({ self: this }, function* () {
              const connection = group[0]?.connection
              if (connection === undefined) {
                return
              }
              yield* this.authorizeObserver(connection)
              for (const frame of group) {
                if (frame.connection.readyState === WebSocket.OPEN) {
                  // A peer can close while the batch awaits its authority check.
                  yield* Effect.try(() => frame.send(frame.data)).pipe(Effect.ignore)
                }
              }
            }).pipe(
              Effect.catch(() =>
                Effect.sync(() => {
                  for (const frame of group) {
                    if (frame.connection.readyState === WebSocket.OPEN) {
                      frame.connection.close(1008, 'Access unavailable')
                    }
                  }
                })
              )
            )
          }
        })
      )
      .finally(() => {
        this.disclosurePending = false
        if (this.disclosures.length > 0) {
          this.flushDisclosures()
        }
      })
    this.ctx.waitUntil(flush)
  }

  // Called by the AIChatAgent runtime through its lifecycle/protocol interface.
  // fallow-ignore-next-line unused-class-member
  override broadcast(
    data: string | ArrayBuffer | ArrayBufferView,
    without?: Array<string>
  ) {
    const excluded = new Set(without)
    for (const connection of this.getConnections()) {
      if (excluded.has(connection.id)) {
        continue
      }
      this.guardSend(connection)
      connection.send(data)
    }
    this.publishSnapshot()
  }

  private snapshotPending = false
  private snapshotQueued = false
  private publishSnapshot() {
    if (this.snapshotPending) {
      this.snapshotQueued = true
      return
    }
    if ([...this.getConnections()].length === 0) {
      return
    }
    this.snapshotPending = true
    const publication = this.runtime
      .runPromise(
        Effect.gen({ self: this }, function* () {
          yield* Effect.sleep('100 millis')
          for (const connection of this.getConnections()) {
            this.guardSend(connection)
            yield* decodeConnectionState(connection.state).pipe(
              Effect.flatMap(({ credential }) => this.history(credential, null)),
              Effect.tap((history) =>
                Effect.sync(() =>
                  connection.send(
                    JSON.stringify({ type: 'conversation_snapshot', history })
                  )
                )
              ),
              Effect.catch(() =>
                Effect.sync(() => connection.close(1008, 'Access unavailable'))
              )
            )
          }
        })
      )
      .finally(() => {
        this.snapshotPending = false
        if (this.snapshotQueued) {
          this.snapshotQueued = false
          this.publishSnapshot()
        }
      })
    this.ctx.waitUntil(publication)
  }

  private watchAuthority() {
    return Effect.tryPromise({
      try: () => this.scheduleEvery(15, 'revalidateAuthority'),
      catch: () => new ConversationUnavailable({ reason: 'storage' })
    }).pipe(Effect.asVoid)
  }

  revalidateAuthority() {
    return this.runtime.runPromise(
      Effect.gen({ self: this }, function* () {
        const active = yield* this.ledger.active()
        if (active !== null) {
          const input = yield* this.ledger.input(active.id, Execution)
          yield* this.authorize(
            input.credential,
            'write',
            active,
            input.runAccessRevision
          ).pipe(Effect.catch(() => this.terminal(active, 'Interrupted', 'authority')))
        }
        for (const connection of this.getConnections()) {
          yield* this.authorizeObserver(connection).pipe(
            Effect.catch(() =>
              Effect.sync(() => connection.close(1008, 'Access unavailable'))
            )
          )
        }
        if (
          (yield* this.ledger.active()) === null &&
          [...this.getConnections()].length === 0
        ) {
          const schedules = yield* Effect.tryPromise(() => this.listSchedules())
          for (const schedule of schedules) {
            if (schedule.callback === 'revalidateAuthority') {
              yield* Effect.tryPromise(() => this.cancelSchedule(schedule.id))
            }
          }
        }
      })
    )
  }

  // Called by the AIChatAgent runtime through its lifecycle/protocol interface.
  // fallow-ignore-next-line unused-class-member
  override onStart() {
    return this.runtime.runPromise(
      Effect.gen({ self: this }, function* () {
        const pending = yield* this.ledger.pendingOutput()
        this.recoveryAttemptId = pending?.id
        const active = yield* this.ledger.active()
        if (active !== null) {
          yield* this.terminal(active, 'Interrupted', 'process')
        }
      })
    )
  }

  private terminal(
    attempt: ConversationAttempt,
    status: 'Completed' | 'Interrupted' | 'Stopped',
    reason: string | null
  ) {
    return Effect.gen({ self: this }, function* () {
      const now = DateTime.formatIso(yield* DateTime.now)
      const terminal = { ...attempt, status, reason, completedAt: now }
      const changed = yield* this.ledger.update(terminal)
      if (!changed) {
        return
      }
      if (status !== 'Completed') {
        if (this.run?.attemptId === attempt.id) {
          this.run.controller.abort()
        }
      }
      const admission = yield* AssistantAdmission
      yield* admission.release(attempt.id)
      const id = yield* this.ledger.identity()
      const directory = yield* AssistantDirectory
      const row = id === null ? null : yield* directory.get(id)
      if (row !== null) {
        yield* recordConversationOutcome(row.id, row.workspaceId, terminal).pipe(
          Effect.catch(() => Effect.void)
        )
      }
      this.publishSnapshot()
    })
  }

  private history(
    credential: AssistantCredentialReference,
    cursor: string | null,
    full = false
  ) {
    return Effect.gen({ self: this }, function* () {
      const { row } = yield* this.authorize(credential, 'read')
      const questions = yield* this.ledger.questions()
      const attempts = yield* this.ledger.attempts()
      const page = conversationHistoryPage({
        questions,
        attempts,
        cursor,
        full,
        policyRevision: row.policyRevision,
        text: (attemptId) =>
          this.run?.attemptId === attemptId
            ? this.run.text
            : savedText(this.messages, attemptId)
      })
      // Content and required-permission revision must describe the same snapshot.
      const directory = yield* AssistantDirectory
      if (!(yield* directory.policyMatches(row.id, row.policyRevision))) {
        return yield* new ConversationUnavailable({ reason: 'authority' })
      }
      return page
    })
  }

  private handle(request: Request) {
    return Effect.gen({ self: this }, function* () {
      if (
        new URL(request.url).pathname === '/invalidate' &&
        request.method === 'POST'
      ) {
        const id = request.headers.get('x-starter-assistant-invalidate')
        if (id === null || id !== (yield* this.ledger.identity())) {
          return new Response(null, { status: 204 })
        }
        yield* Effect.tryPromise({
          try: () => this.revalidateAuthority(),
          catch: () => new ConversationUnavailable({ reason: 'authority' })
        })
        return new Response(null, { status: 204 })
      }
      if (new URL(request.url).pathname === '/cleanup' && request.method === 'POST') {
        const id = request.headers.get('x-starter-assistant-cleanup')
        const directory = yield* AssistantDirectory
        const row = id === null ? null : yield* directory.get(id)
        if (!row?.deletedAt) {
          return yield* new ConversationNotFound()
        }
        const bound = yield* this.ledger.identity()
        if (bound !== null && bound !== row.id) {
          return yield* new ConversationNotFound()
        }
        // SDK destruction can abort before its response arrives. A fresh object
        // with no bound identity has never accepted content or has already been wiped.
        if (bound === null) {
          return new Response(null, { status: 204 })
        }
        const run = this.run
        const active = yield* this.ledger.active()
        if (active !== null) {
          yield* this.terminal(active, 'Interrupted', 'deleted')
        }
        run?.controller.abort()
        for (const connection of this.getConnections()) {
          connection.close(1008, 'Conversation deleted')
        }
        yield* Effect.tryPromise({
          try: async () => {
            await run?.completion
          },
          catch: () => new ConversationUnavailable({ reason: 'storage' })
        })
        yield* Effect.tryPromise({
          try: () => this.destroy(),
          catch: () => new ConversationUnavailable({ reason: 'storage' })
        })
        return new Response(null, { status: 204 })
      }
      const invocation = yield* this.invocation(request)
      const credential = invocation.credential
      const url = new URL(request.url)
      const action = url.pathname.split('/').at(-1)
      if (request.method === 'GET') {
        if (action === 'events') {
          const attemptId = url.searchParams.get('attemptId') ?? ''
          const observation = yield* this.authorize(credential, 'read')
          const snapshot = Effect.gen({ self: this }, function* () {
            const { row } = yield* this.authorize(credential, 'read')
            if (row.runAccessRevision !== observation.row.runAccessRevision) {
              return yield* new ConversationUnavailable({ reason: 'authority' })
            }
            const attempt = yield* this.ledger.attempt(attemptId)
            const question =
              attempt === null ? null : yield* this.ledger.question(attempt.questionId)
            if (attempt === null || question === null) {
              return yield* new ConversationNotFound()
            }
            const text =
              this.run?.attemptId === attempt.id
                ? this.run.text
                : savedText(this.messages, attempt.id)
            const directory = yield* AssistantDirectory
            if (!(yield* directory.policyMatches(row.id, row.policyRevision))) {
              return yield* new ConversationUnavailable({ reason: 'authority' })
            }
            return {
              question,
              attempt: { ...attempt, text },
              policyRevision: row.policyRevision
            }
          })
          yield* snapshot
          return yield* observeConversationAttempt(
            invocation.conversationId,
            snapshot,
            request.headers.get('last-event-id')
          )
        }
        if (action === 'history' || action === 'export') {
          return Response.json(
            yield* this.history(
              credential,
              url.searchParams.get('cursor'),
              action === 'export'
            )
          )
        }
        if (action === 'read') {
          const { row } = yield* this.authorize(credential, 'read')
          const questions = yield* this.ledger.questions()
          const activeAttempt = yield* this.ledger.active()
          const directory = yield* AssistantDirectory
          if (!(yield* directory.policyMatches(row.id, row.policyRevision))) {
            return yield* new ConversationUnavailable({ reason: 'authority' })
          }
          return Response.json({
            ...row,
            title:
              questions[0] === undefined ? null : conversationTitle(questions[0].text),
            activeAttempt
          })
        }
        return new Response(null, { status: 404 })
      }
      if (request.method !== 'POST') {
        return new Response(null, { status: 404 })
      }
      yield* this.authorize(credential, 'write')
      if (action === 'stop') {
        const input = yield* decodeStop(yield* Effect.tryPromise(() => request.json()))
        const attempt = yield* this.ledger.attempt(input.attemptId)
        if (attempt === null) {
          return yield* new ConversationNotFound()
        }
        const run = this.run?.attemptId === attempt.id ? this.run : undefined
        yield* this.terminal(attempt, 'Stopped', 'stopped')
        yield* Effect.tryPromise({
          try: async () => {
            await run?.completion
          },
          catch: () => new ConversationUnavailable({ reason: 'storage' })
        })
        return Response.json(yield* this.ledger.attempt(attempt.id))
      }
      if (action !== 'send' && action !== 'retry') {
        return new Response(null, { status: 404 })
      }
      const body = yield* Effect.tryPromise(() => request.json())
      const input =
        action === 'send' ? yield* decodeSend(body) : yield* decodeRetry(body)
      // This object serializes the complete cross-store admission protocol.
      const result = yield* this.accept(credential, input).pipe(
        this.admission.withPermits(1)
      )
      return Response.json(result, { status: result.joined ? 200 : 202 })
    })
  }

  private accept(
    credential: AssistantCredentialReference,
    input: ConversationSend | ConversationRetry
  ) {
    return Effect.gen({ self: this }, function* () {
      const { row } = yield* this.authorize(credential, 'write')
      const limits = yield* conversationLimits(this.env)
      // Arm recovery before acceptance can cross the SQLite/D1 commit boundary.
      yield* this.watchAuthority()
      const acceptance = yield* acceptConversationAnswer({
        credential,
        row,
        operation: input,
        ledger: this.ledger,
        executionBusy:
          (yield* this.ledger.pendingOutput()) !== null ||
          (this.run !== undefined && !this.run.settled),
        savedText: (id) => savedText(this.messages, id),
        limits
      }).pipe(Effect.provide(selectConversationModelLayer(this.env, limits)))
      if (acceptance.joined) {
        return acceptance
      }
      const { question, attempt } = acceptance
      const run: ConversationRun = {
        attemptId: attempt.id,
        controller: new AbortController(),
        text: '',
        settled: false
      }
      this.run = run
      run.completion = this.saveMessages(
        (messages) =>
          messages.some((message) => message.id === question.id)
            ? [...messages]
            : [
                ...messages,
                {
                  id: question.id,
                  role: 'user',
                  parts: [{ type: 'text', text: question.text }]
                }
              ],
        { signal: run.controller.signal }
      )
        .then(() => undefined)
        .catch(() =>
          this.runtime.runPromise(
            Effect.gen({ self: this }, function* () {
              const current = yield* this.ledger.attempt(attempt.id)
              if (current !== null) {
                yield* this.terminal(current, 'Interrupted', 'provider')
              }
            })
          )
        )
        .finally(() => {
          run.settled = true
        })
      this.ctx.waitUntil(run.completion)
      return acceptance
    })
  }

  // Called by the AIChatAgent runtime through its lifecycle/protocol interface.
  // fallow-ignore-next-line unused-class-member
  override onChatMessage(
    _finish: Parameters<AIChatAgent<Env>['onChatMessage']>[0],
    options?: OnChatMessageOptions
  ) {
    return this.runtime.runPromise(
      Effect.gen({ self: this }, function* () {
        const run = this.run
        const attempt = yield* this.ledger.active()
        if (
          attempt === null ||
          run?.attemptId !== attempt.id ||
          options?.continuation
        ) {
          return yield* new ConversationUnavailable({ reason: 'authority' })
        }
        const execution = yield* this.ledger.input(attempt.id, Execution)
        yield* this.authorize(
          execution.credential,
          'write',
          attempt,
          execution.runAccessRevision
        ).pipe(
          Effect.tapError(() => this.terminal(attempt, 'Interrupted', 'authority'))
        )
        let current: ConversationAttempt = { ...attempt, status: 'Running' }
        yield* this.ledger.update(current)
        const limits = yield* conversationLimits(this.env)
        const signal = AbortSignal.any([
          ...(options?.abortSignal ? [options.abortSignal] : []),
          run.controller.signal,
          AbortSignal.timeout(Math.max(1, attempt.deadline - Date.now()))
        ])
        const stream = createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({ type: 'start', messageId: attempt.id })
            writer.write({ type: 'text-start', id: attempt.id })
            let failureReason = 'provider'
            const consume = Effect.gen({ self: this }, function* () {
              const model = yield* ConversationModel
              yield* model.stream(execution.prompt).pipe(
                Stream.runForEach((event) =>
                  Effect.gen({ self: this }, function* () {
                    yield* this.authorize(
                      execution.credential,
                      'write',
                      attempt,
                      execution.runAccessRevision
                    )
                    const stored = yield* this.ledger.attempt(attempt.id)
                    if (stored === null || !activeConversationAttempt(stored)) {
                      return yield* new ConversationUnavailable({ reason: 'authority' })
                    }
                    if (event.type === 'text-delta') {
                      run.text += event.text
                      writer.write({
                        type: 'text-delta',
                        id: attempt.id,
                        delta: event.text
                      })
                    } else if (event.type === 'metadata') {
                      current = {
                        ...current,
                        provider: event.provider,
                        modelId: event.modelId,
                        providerRequestId: event.providerRequestId ?? null
                      }
                      yield* this.ledger.update(current)
                      writer.write({ type: 'message-metadata', messageMetadata: event })
                    } else {
                      current = {
                        ...current,
                        finishReason: event.reason,
                        inputTokens: event.inputTokens ?? null,
                        outputTokens: event.outputTokens ?? null
                      }
                      yield* this.ledger.update(current)
                    }
                  })
                )
              )
              writer.write({ type: 'text-end', id: attempt.id })
              writer.write({ type: 'finish', finishReason: 'stop' })
            }).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => {
                  if (
                    error._tag === 'ConversationModelFailure' &&
                    error.reason === 'output-limit'
                  ) {
                    failureReason = 'output_limit'
                  } else if (
                    error._tag === 'AssistantAuthorityDenied' ||
                    error._tag === 'ConversationNotFound' ||
                    (error._tag === 'ConversationUnavailable' &&
                      error.reason === 'authority')
                  ) {
                    failureReason = 'authority'
                  }
                })
              ),
              Effect.provide(selectConversationModelLayer(this.env, limits))
            )
            return this.runtime
              .runPromise(
                withTriggerScope(
                  {
                    service: 'assistant',
                    event: 'assistant.answer',
                    env: this.env,
                    metadata: { attemptId: attempt.id, questionId: attempt.questionId }
                  },
                  consume
                ).pipe(
                  Effect.provide(makeOtlpLayer('assistant', this.env), { local: true })
                ),
                { signal }
              )
              .then(
                () => this.persistFinal(run, current, 'Completed', null),
                () => {
                  writer.write(
                    signal.aborted
                      ? { type: 'abort', reason: 'The answer was interrupted.' }
                      : {
                          type: 'error',
                          errorText: 'The answer was interrupted. Retry explicitly.'
                        }
                  )
                  let reason = failureReason
                  if (current.finishReason === 'length') {
                    reason = 'output_limit'
                  }
                  if (signal.aborted) {
                    reason = 'deadline_or_stop'
                  }
                  return this.persistFinal(run, current, 'Interrupted', reason)
                }
              )
          },
          onError: () => 'The answer was interrupted. Retry explicitly.'
        })
        return createUIMessageStreamResponse({ stream })
      })
    )
  }

  private persistFinal(
    run: ConversationRun,
    attempt: ConversationAttempt,
    status: 'Completed' | 'Interrupted',
    reason: string | null
  ) {
    return this.persistMessages([
      ...this.messages.filter((message) => message.id !== attempt.id),
      {
        id: attempt.id,
        role: 'assistant',
        parts: [{ type: 'text', text: run.text }]
      }
    ]).then(() =>
      this.runtime.runPromise(
        this.ledger
          .finishOutput(attempt.id)
          .pipe(Effect.andThen(this.terminal(attempt, status, reason)))
      )
    )
  }

  protected override onChatRecovery(context: ChatRecoveryContext) {
    return this.runtime.runPromise(
      Effect.gen({ self: this }, function* () {
        const attempt =
          this.recoveryAttemptId === undefined
            ? null
            : yield* this.ledger.attempt(this.recoveryAttemptId)
        if (
          attempt !== null &&
          context.partialText.length > savedText(this.messages, attempt.id).length
        ) {
          yield* Effect.tryPromise({
            try: () =>
              this.persistMessages([
                ...this.messages.filter((message) => message.id !== attempt.id),
                {
                  id: attempt.id,
                  role: 'assistant',
                  parts: [{ type: 'text', text: context.partialText }]
                }
              ]),
            catch: () => new ConversationUnavailable({ reason: 'storage' })
          })
        }
        if (attempt !== null) {
          yield* this.ledger.finishOutput(attempt.id)
          yield* this.terminal(attempt, 'Interrupted', 'process')
        }
        this.publishSnapshot()
        // Persist once through the SDK above; its orphan merger would otherwise append the same text part twice.
        return { continue: false satisfies false, persist: false }
      })
    )
  }

  private respond<A extends Response, E>(
    request: Request,
    effect: Effect.Effect<A, E, CapabilityServices>
  ) {
    return this.runtime.runPromise(
      withHttpInvocation(
        { service: 'assistant', event: 'assistant.request', request, env: this.env },
        effect.pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              const tagged = decodeFailure(error)
              if (tagged._tag === 'Failure') {
                return Response.json(
                  { error: 'ConversationUnavailable' },
                  { status: 503 }
                )
              }
              return failureResponse(tagged.success)
            })
          ),
          Effect.tap((response) =>
            Effect.annotateLogsScoped({ status: response.status })
          )
        )
      )
    )
  }
}
