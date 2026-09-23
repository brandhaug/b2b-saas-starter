import { Deferred, Effect, Schema, Stream } from 'effect'
import { ConversationLedger } from '../../src/lib/assistant/conversation-ledger'
import {
  ConversationUnavailable,
  type ConversationAttempt
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import {
  readConversationHistory,
  prepareTranscriptContext,
  type ConversationTranscript
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-transcript'
import { ConversationModel } from '@b2b-saas-starter/ai/conversation'
import { prepareConversationContext } from '@b2b-saas-starter/ai/conversation-context'
import { type AgentContext } from 'agents'
import { WorkspaceAssistantConversation as ConversationHost } from '../../src/lib/assistant/conversation-host'

const decodeSeedInput = Schema.decodeUnknownSync(
  Schema.Struct({ conversationId: Schema.String })
)

/** Deterministic storage barrier exists only in this test Worker. */
export class WorkspaceAssistantConversation extends ConversationHost {
  override hydrationByteBudget = 1024

  private persistenceGate: Deferred.Deferred<boolean> | undefined
  private persistenceWaiting = false

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env)
    const fetch = this.fetch.bind(this)
    this.fetch = async (request) => {
      const action = new URL(request.url).pathname.split('/').at(-1)
      if (action === 'seed-transcript') {
        const input = decodeSeedInput(await request.json())
        const ledger = new ConversationLedger(ctx.storage)
        const messages: Parameters<ConversationHost['persistMessages']>[0] = []
        // oxlint-disable-next-line starter/no-run-promise-in-tests -- test-only Worker fixture bridge
        await Effect.runPromise(
          Effect.gen(function* () {
            yield* ledger.bind(input.conversationId)
            for (let index = 0; index < 100; index += 1) {
              const suffix = String(index).padStart(3, '0')
              const question = {
                id: `q-${suffix}`,
                text: `Question ${suffix}`,
                createdAt: '2026-09-15T12:00:00.000Z',
                taskId: null
              }
              const attempt: ConversationAttempt = {
                id: `a-${suffix}`,
                questionId: question.id,
                createdAt: question.createdAt,
                deadline: 600_000,
                status: 'Completed',
                reason: null,
                completedAt: question.createdAt,
                provider: null,
                modelId: null,
                providerRequestId: null,
                finishReason: null,
                inputTokens: null,
                outputTokens: null,
                omittedExchanges: 0,
                evidence: null
              }
              if (index === 90) {
                const interrupted: ConversationAttempt = {
                  ...attempt,
                  id: 'a-090-interrupted',
                  status: 'Interrupted',
                  reason: 'provider'
                }
                yield* ledger.accept({
                  key: interrupted.id,
                  hash: interrupted.id,
                  acceptance: { question, attempt: interrupted, joined: false },
                  execution: {}
                })
                messages.push({
                  id: interrupted.id,
                  role: 'assistant',
                  parts: [{ type: 'text', text: 'Saved incomplete answer' }]
                })
              }
              yield* ledger.accept({
                key: attempt.id,
                hash: attempt.id,
                acceptance: { question, attempt, joined: false },
                execution: {}
              })
              messages.push(
                {
                  id: question.id,
                  role: 'user',
                  parts: [{ type: 'text', text: question.text }]
                },
                {
                  id: attempt.id,
                  role: 'assistant',
                  parts: [{ type: 'text', text: 'Answer '.repeat(100) }]
                }
              )
            }
          })
        )
        await this.persistMessages(messages)
        return new Response(null, { status: 204 })
      }
      if (action === 'transcript-read-probe') {
        const ledger = new ConversationLedger(ctx.storage)
        let historyDecoded = 0
        let promptDecoded = 0
        const store: ConversationTranscript = {
          questions: (page) =>
            ledger.questions(page).pipe(
              Effect.tap((rows) =>
                Effect.sync(() => {
                  historyDecoded += rows.length
                })
              )
            ),
          attempts: (ids) =>
            ledger.attempts(ids).pipe(
              Effect.tap((rows) =>
                Effect.sync(() => {
                  historyDecoded += rows.length
                })
              )
            ),
          completed: (page) =>
            ledger.completed(page).pipe(
              Effect.tap((rows) =>
                Effect.sync(() => {
                  promptDecoded += rows.length * 2
                })
              )
            ),
          completedCount: () => ledger.completedCount(),
          recentFailures: () =>
            ledger.recentFailures().pipe(
              Effect.tap((rows) =>
                Effect.sync(() => {
                  promptDecoded += rows.length
                })
              )
            ),
          firstQuestion: () => ledger.firstQuestion()
        }
        const session = this.sessions.session()
        function text(id: string) {
          return Effect.tryPromise({
            try: () => session.getMessage(id),
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
        const limits = {
          maxInputTokens: 3000,
          maxOutputTokens: 16_000,
          providerContextTokens: 128_000,
          providerOutputTokens: 16_000
        }
        const hydratedMessages = this.messages.length
        // oxlint-disable-next-line starter/no-run-promise-in-tests -- test-only Worker measurement bridge
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const page = yield* readConversationHistory(store, {
              cursor: null,
              full: false,
              policyRevision: 0,
              text
            })
            const prepared = yield* prepareTranscriptContext(store, {
              workspaceSlug: 'do-fixture',
              question: 'Next',
              text
            }).pipe(
              Effect.provideService(
                ConversationModel,
                ConversationModel.of({
                  prepare: (input) => prepareConversationContext(input, limits),
                  stream: () => Stream.empty
                })
              )
            )
            const reference = yield* prepareConversationContext(
              {
                workspaceSlug: 'do-fixture',
                question: 'Next',
                history: yield* Effect.forEach(
                  yield* ledger.completed({ before: null, limit: 100 }),
                  ({ question, attempt }) =>
                    text(attempt.id).pipe(
                      Effect.map((answer) => ({
                        questionId: question.id,
                        question: question.text,
                        answer
                      }))
                    )
                ),
                failureObservations: [
                  {
                    questionId: 'q-090',
                    attemptId: 'a-090-interrupted',
                    reason: 'provider'
                  }
                ]
              },
              limits
            )
            return {
              page,
              prepared,
              reference,
              historyDecoded,
              promptDecoded,
              hydratedMessages
            }
          })
        )
        return Response.json(result)
      }
      if (action === 'corrupt-terminal-attempt') {
        ctx.storage.sql.exec(
          "UPDATE assistant_attempts SET data=json_set(data,'$.completedAt',NULL) WHERE id='a-099'"
        )
        return new Response(null, { status: 204 })
      }
      if (action === 'abort-object') {
        ctx.abort('Injected object interruption')
      }
      if (action === 'observers-open') {
        return new Response(null, {
          status: [...this.getConnections()].length > 0 ? 204 : 404
        })
      }
      if (action === 'pause-persistence') {
        this.persistenceGate = Deferred.makeUnsafe<boolean>()
        this.persistenceWaiting = false
        return new Response(null, { status: 204 })
      }
      if (action === 'persistence-waiting') {
        return new Response(null, { status: this.persistenceWaiting ? 204 : 409 })
      }
      if (action === 'release-persistence') {
        const gate = this.persistenceGate
        this.persistenceGate = undefined
        if (gate !== undefined) {
          // oxlint-disable-next-line starter/no-run-promise-in-tests -- bridges the test Worker fetch port
          await Effect.runPromise(Deferred.succeed(gate, true))
        }
        return new Response(null, { status: 204 })
      }
      return fetch(request)
    }
  }

  override async persistMessages(
    ...args: Parameters<ConversationHost['persistMessages']>
  ) {
    const gate = this.persistenceGate
    if (gate !== undefined && args[0].some((message) => message.role === 'assistant')) {
      this.persistenceWaiting = true
      // oxlint-disable-next-line starter/no-run-promise-in-tests -- bridges the SDK persistence Promise port
      await Effect.runPromise(Deferred.await(gate))
    }
    return super.persistMessages(...args)
  }
}

/** Test-only dispatch; production entry points supply verified invocation context. */
export default {
  fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    const conversationId = url.pathname.split('/')[1] ?? ''
    const name = JSON.stringify(['wrk_do', 'usr_do', conversationId])
    const stub = env.ASSISTANT_CONVERSATIONS.get(
      env.ASSISTANT_CONVERSATIONS.idFromName(name)
    )
    url.pathname = `/${url.pathname.split('/').slice(2).join('/')}`
    return stub.fetch(new Request(url, request))
  }
}
