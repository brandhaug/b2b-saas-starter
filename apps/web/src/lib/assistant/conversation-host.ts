import {
  AIChatAgent,
  type ChatRecoveryContext,
  type OnChatMessageOptions
} from '@cloudflare/ai-chat'
import { type AgentContext, type Connection } from 'agents'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { Effect, Layer, ManagedRuntime, Semaphore } from 'effect'
import {
  WideEventLoggerLive,
  withHttpInvocation,
  withTriggerScope,
  makeOtlpLayer
} from '@b2b-saas-starter/logger'
import {
  makeConversationHostLayer,
  type ConversationHostServices
} from '@b2b-saas-starter/capabilities/assistant/runtime'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { AssistantDirectory } from '@b2b-saas-starter/capabilities/assistant/directory'
import {
  authorizeConversation,
  executeConversationAnswer,
  finishConversationAttempt
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-execution'
import {
  acceptConversationAnswer,
  ConversationExecution as Execution
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-admission'
import {
  type ConversationSend,
  type ConversationRetry,
  ConversationNotFound,
  ConversationUnavailable,
  conversationTitle,
  type ConversationAttempt
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { selectConversationModelLayer } from '@b2b-saas-starter/ai/conversation'
import { readConversationHistory } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-transcript'
import { ConversationLedger } from './conversation-ledger'
import { observeConversationAttempt } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-events'
import { installConversationProtocol } from './conversation-sdk'
import { conversationLimits } from './conversation-config'
import {
  decodeConnectionState,
  decodeInvocation,
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

/** The exported host owns SDK persistence/replay; every SDK entry and disclosure is gated here. */
export class WorkspaceAssistantConversation extends AIChatAgent<Env> {
  private readonly protocol: ReturnType<typeof installConversationProtocol>
  private readonly ledger: ConversationLedger
  private readonly runtime: ReturnType<
    typeof ManagedRuntime.make<ConversationHostServices, ConversationUnavailable>
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
        makeConversationHostLayer({
          DB: env.DB,
          assistantResource: env.ASSISTANT_RESOURCE_URL
        }),
        WideEventLoggerLive
      )
    )
    this.protocol = installConversationProtocol(this, {
      request: (request) => this.respond(request, this.handle(request)),
      upgrade: (request, next) =>
        this.respond(
          request,
          Effect.gen({ self: this }, function* () {
            const invocation = yield* this.invocation(request)
            yield* this.authorize(invocation.credential, 'read')
            return yield* Effect.tryPromise({
              try: next,
              catch: () => new ConversationUnavailable({ reason: 'storage' })
            })
          })
        ),
      connect: (request) =>
        this.runtime.runPromise(
          Effect.gen({ self: this }, function* () {
            const invocation = yield* this.invocation(request)
            const { row } = yield* this.authorize(invocation.credential, 'read')
            return {
              credential: invocation.credential,
              runAccessRevision: row.runAccessRevision
            }
          })
        ),
      authorize: (connection) =>
        this.runtime.runPromise(this.authorizeObserver(connection).pipe(Effect.asVoid)),
      connected: (connection, { credential }) =>
        this.runtime.runPromise(
          Effect.gen({ self: this }, function* () {
            connection.send(
              JSON.stringify({
                type: 'conversation_snapshot',
                history: yield* this.history(credential, null)
              })
            )
            yield* this.watchAuthority()
          })
        ),
      disclose: (frame) => {
        this.disclosures.push(frame)
        this.flushDisclosures()
      },
      changed: () => this.publishSnapshot()
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
      return yield* authorizeConversation(
        id,
        credential,
        operation,
        attempt,
        runAccessRevision
      )
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

  private snapshotPublication: 'idle' | 'publishing' | 'publish_again' = 'idle'
  private publishSnapshot() {
    if (this.snapshotPublication !== 'idle') {
      this.snapshotPublication = 'publish_again'
      return
    }
    if ([...this.getConnections()].length === 0) {
      return
    }
    this.snapshotPublication = 'publishing'
    const publication = this.runtime
      .runPromise(
        Effect.gen({ self: this }, function* () {
          yield* Effect.sleep('100 millis')
          for (const connection of this.getConnections()) {
            yield* decodeConnectionState(connection.state).pipe(
              Effect.flatMap(({ credential }) => this.history(credential, null)),
              Effect.tap((history) =>
                Effect.sync(() =>
                  this.protocol.send(
                    connection,
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
        const repeat = this.snapshotPublication === 'publish_again'
        this.snapshotPublication = 'idle'
        if (repeat) {
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
      const terminal = yield* finishConversationAttempt(
        this.ledger,
        yield* this.ledger.identity(),
        attempt,
        status,
        reason,
        () => {
          if (status !== 'Completed' && this.run?.attemptId === attempt.id) {
            this.run.controller.abort()
          }
        }
      )
      if (terminal === null) {
        return
      }
      this.publishSnapshot()
    })
  }

  private savedText(id: string) {
    return Effect.tryPromise({
      try: () => this.sessions.session().getMessage(id),
      catch: () => new ConversationUnavailable({ reason: 'storage' })
    }).pipe(
      Effect.map(
        (message) =>
          message?.parts
            .flatMap((part) => (part.type === 'text' ? [part.text ?? ''] : []))
            .join('') ?? ''
      )
    )
  }

  private history(
    credential: AssistantCredentialReference,
    cursor: string | null,
    full = false
  ) {
    return Effect.gen({ self: this }, function* () {
      const { row } = yield* this.authorize(credential, 'read')
      const page = yield* readConversationHistory(this.ledger, {
        cursor,
        full,
        policyRevision: row.policyRevision,
        text: (attemptId) =>
          this.run?.attemptId === attemptId
            ? Effect.succeed(this.run.text)
            : this.savedText(attemptId)
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
                : yield* this.savedText(attempt.id)
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
          const first = yield* this.ledger.firstQuestion()
          const activeAttempt = yield* this.ledger.active()
          const directory = yield* AssistantDirectory
          if (!(yield* directory.policyMatches(row.id, row.policyRevision))) {
            return yield* new ConversationUnavailable({ reason: 'authority' })
          }
          return Response.json({
            ...row,
            title: first === null ? null : conversationTitle(first.text),
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
        savedText: (id) => this.savedText(id),
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
            const consume = Effect.gen({ self: this }, function* () {
              const id = yield* this.ledger.identity()
              if (id === null) {
                return yield* new ConversationNotFound()
              }
              yield* executeConversationAnswer({
                conversationId: id,
                attempt,
                execution,
                ledger: this.ledger,
                emit: (event) => {
                  if (event.type === 'text-delta') {
                    run.text += event.text
                    writer.write({
                      type: 'text-delta',
                      id: attempt.id,
                      delta: event.text
                    })
                  } else if (event.type === 'metadata') {
                    writer.write({ type: 'message-metadata', messageMetadata: event })
                  }
                },
                persistOutput: Effect.tryPromise({
                  try: () => this.persistOutput(run, attempt),
                  catch: () => new ConversationUnavailable({ reason: 'storage' })
                }),
                finish: (current, status, reason) =>
                  this.terminal(current, status, reason)
              })
              writer.write({ type: 'text-end', id: attempt.id })
              writer.write({ type: 'finish', finishReason: 'stop' })
            }).pipe(Effect.provide(selectConversationModelLayer(this.env, limits)))
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
              .catch(() => {
                writer.write(
                  signal.aborted
                    ? { type: 'abort', reason: 'The answer was interrupted.' }
                    : {
                        type: 'error',
                        errorText: 'The answer was interrupted. Retry explicitly.'
                      }
                )
              })
          },
          onError: () => 'The answer was interrupted. Retry explicitly.'
        })
        return createUIMessageStreamResponse({ stream })
      })
    )
  }

  private persistOutput(run: ConversationRun, attempt: ConversationAttempt) {
    return this.persistMessages([
      ...this.messages.filter((message) => message.id !== attempt.id),
      {
        id: attempt.id,
        role: 'assistant',
        parts: [{ type: 'text', text: run.text }]
      }
    ]).then(() => this.runtime.runPromise(this.ledger.finishOutput(attempt.id)))
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
          context.partialText.length > (yield* this.savedText(attempt.id)).length
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
    effect: Effect.Effect<A, E, ConversationHostServices>
  ) {
    return this.runtime
      .runPromise(
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
      .catch(() =>
        failureResponse(new ConversationUnavailable({ reason: 'configuration' }))
      )
  }
}
