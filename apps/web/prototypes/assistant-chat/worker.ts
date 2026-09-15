// PROTOTYPE: scratch identities and storage. Never deploy as application auth.
import {
  AIChatAgent,
  type OnChatMessageOptions,
  type ChatRecoveryContext
} from '@cloudflare/ai-chat'
import { getAgentByName, type AgentContext, type Connection } from 'agents'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage
} from 'ai'
import { Effect, Layer, Schema, Stream } from 'effect'
import {
  AiError,
  LanguageModel,
  Model,
  Prompt,
  type Response as ModelResponse
} from 'effect/unstable/ai'

interface Env {
  AssistantPrototype: DurableObjectNamespace<AssistantPrototype>
  ASSETS: Fetcher
}
type Run = {
  key: string
  question: string
  mode: string
  chunks: number
  delay: number
  status: string
  request_id: string | null
  ordinal: number
}
const Send = Schema.Struct({
  key: Schema.String,
  question: Schema.String,
  mode: Schema.Literals(['normal', 'fail']),
  chunks: Schema.Number,
  delay: Schema.Number
})
const actorOf = (request: Request) => {
  const credential =
    request.headers.get('authorization')?.replace(/^Bearer /, '') ??
    request.headers.get('cookie')?.match(/prototype-session=([^;]+)/)?.[1]
  return credential === 'prototype-member-alice'
    ? 'alice'
    : credential === 'prototype-member-bob'
      ? 'bob'
      : null
}
const refused = async (request: Request) => {
  // Scratch-only workerd workaround: consume rejected fixture bodies before reply.
  await request.arrayBuffer()
  return new Response('Not found', { status: 404 })
}

function modelFor(run: Run) {
  return Model.make(
    'prototype',
    'deterministic-effect',
    Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: () =>
          Effect.succeed([
            { type: 'text', text: 'unused' },
            {
              type: 'finish',
              reason: 'stop',
              usage: { inputTokens: {}, outputTokens: {} }
            }
          ]),
        streamText: (options) => {
          const historyCount = options.prompt.content.length
          const parts: ModelResponse.StreamPartEncoded[] = [
            { type: 'response-metadata', modelId: 'deterministic-effect' },
            { type: 'text-start', id: 'text' },
            ...Array.from(
              { length: run.chunks },
              (_, i): ModelResponse.StreamPartEncoded => ({
                type: 'text-delta',
                id: 'text',
                delta: `[${i + 1}/${run.chunks}; context=${historyCount}] `
              })
            ),
            { type: 'text-end', id: 'text' },
            {
              type: 'finish',
              reason: 'stop',
              usage: { inputTokens: {}, outputTokens: {} }
            }
          ]
          return Stream.fromIterable(parts).pipe(
            Stream.mapEffect((part) =>
              Effect.gen(function* () {
                if (part.type === 'text-delta') {
                  yield* Effect.sleep(run.delay)
                  if (run.mode === 'fail' && part.delta.startsWith('[8/')) {
                    return yield* AiError.make({
                      module: 'prototype',
                      method: 'streamText',
                      reason: new AiError.UnknownError({
                        description: 'deliberate provider failure'
                      })
                    })
                  }
                }
                return part
              })
            )
          )
        }
      })
    )
  )
}

export class AssistantPrototype extends AIChatAgent<Env, { revoked: boolean }> {
  initialState = { revoked: false }
  private activeAbort?: AbortController
  private activeCompletion?: Promise<void>

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env)
    this
      .sql`create table if not exists prototype_runs (key text primary key, question text, mode text, chunks integer, delay integer, status text, request_id text, ordinal integer)`
    this
      .sql`create table if not exists prototype_events (seq integer primary key autoincrement, kind text, detail text)`
    // AIChatAgent installs protocol wrappers during super(). Gate outside them.
    const requestHandler = this.onRequest.bind(this)
    this.onRequest = async (request) => {
      if (actorOf(request) !== 'alice') return refused(request)
      if (this.state.revoked && !new URL(request.url).pathname.endsWith('/authority'))
        return refused(request)
      return requestHandler(request)
    }
    const connectHandler = this.onConnect.bind(this)
    this.onConnect = (connection, context) => {
      if (actorOf(context.request) !== 'alice' || this.state.revoked) {
        connection.close(1008, 'Access denied')
        return
      }
      connection.setState({ actor: 'alice' })
      return connectHandler(connection, context)
    }
    const messageHandler = this.onMessage.bind(this)
    this.onMessage = (connection, message) => {
      if (
        !Schema.is(Schema.Struct({ actor: Schema.Literal('alice') }))(
          connection.state
        ) ||
        this.state.revoked
      ) {
        connection.close(1008, 'Access revoked')
        return
      }
      if (typeof message !== 'string') return
      let frame: { type?: string }
      try {
        frame = JSON.parse(message)
      } catch {
        return
      }
      // HTTP is the sole mutation admission path for both clients. WebSockets observe.
      if (
        !['cf_agent_stream_resume_request', 'cf_agent_stream_resume_ack'].includes(
          frame.type ?? ''
        )
      ) {
        connection.send(
          JSON.stringify({ type: 'prototype_denied', operation: frame.type })
        )
        return
      }
      return messageHandler(connection, message)
    }
  }

  canAccess(member: string) {
    return member === 'alice' && !this.state.revoked
  }

  private event(kind: string, detail: unknown) {
    this
      .sql`insert into prototype_events(kind,detail) values (${kind},${JSON.stringify(detail)})`
  }
  private runs() {
    return this.sql<Run>`select * from prototype_runs order by ordinal`
  }
  private finish(key: string, status: string) {
    this
      .sql`update prototype_runs set status=${status} where key=${key} and status in ('accepted','streaming')`
  }

  override onStart() {
    const active = this
      .sql<Run>`select * from prototype_runs where status in ('accepted','streaming')`
    for (const run of active) {
      this.finish(run.key, 'interrupted')
      this.event('restart-interrupted', { key: run.key })
    }
  }

  override async onRequest(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.split('/').pop()
    if (action === 'snapshot')
      return Response.json({
        owner: 'alice',
        state: this.state,
        runs: this.runs(),
        messages: this.messages,
        events: this.sql`select * from prototype_events order by seq`
      })
    if (action === 'authority' && request.method === 'POST') {
      const body = (await request.json()) as { revoked: boolean }
      this.setState({ revoked: body.revoked })
      if (body.revoked) {
        for (const run of this.runs().filter((r) =>
          ['accepted', 'streaming'].includes(r.status)
        ))
          this.finish(run.key, 'interrupted')
        this.activeAbort?.abort()
        for (const connection of this.getConnections())
          connection.close(1008, 'Access revoked')
        await this.activeCompletion
      }
      this.event('authority', body)
      return Response.json(this.state)
    }
    if (action === 'stop' && request.method === 'POST') {
      await request.arrayBuffer()
      for (const run of this.runs().filter((r) =>
        ['accepted', 'streaming'].includes(r.status)
      ))
        this.finish(run.key, 'stopped')
      this.activeAbort?.abort()
      await this.activeCompletion
      return Response.json({ status: 'stopped' })
    }
    if (action === 'send' && request.method === 'POST') {
      let input: typeof Send.Type
      try {
        input = Schema.decodeUnknownSync(Send)(await request.json())
      } catch {
        return new Response('Invalid send', { status: 400 })
      }
      if (
        !input.key ||
        input.key.length > 100 ||
        input.question.length > 2000 ||
        input.chunks < 1 ||
        input.chunks > 200 ||
        input.delay < 20 ||
        input.delay > 5000
      )
        return new Response('Invalid limits', { status: 400 })
      const old = this.sql<Run>`select * from prototype_runs where key=${input.key}`[0]
      if (old) {
        if (
          old.question !== input.question ||
          old.mode !== input.mode ||
          old.chunks !== input.chunks ||
          old.delay !== input.delay
        )
          return new Response('Key reused for different request', { status: 409 })
        return Response.json({ joined: true, run: old })
      }
      if (this.runs().some((r) => ['accepted', 'streaming'].includes(r.status)))
        return new Response('Answer in progress', { status: 409 })
      const ordinal = this.runs().length + 1
      this
        .sql`insert into prototype_runs values (${input.key},${input.question},${input.mode},${input.chunks},${input.delay},'accepted',null,${ordinal})`
      const controller = new AbortController()
      this.activeAbort = controller
      const completion = this.saveMessages((messages) => [
        ...messages,
        { id: input.key, role: 'user', parts: [{ type: 'text', text: input.question }] }
      ])
        .then((result) => {
          this.finish(
            input.key,
            result.status === 'completed'
              ? 'completed'
              : result.status === 'aborted'
                ? 'stopped'
                : 'interrupted'
          )
          this.event('sdk-result', { key: input.key, result })
          if (this.activeAbort === controller) this.activeAbort = undefined
        })
        .catch((error) => {
          this.finish(input.key, 'interrupted')
          this.event('sdk-error', { key: input.key, message: String(error) })
        })
      this.activeCompletion = completion
      this.ctx.waitUntil(completion)
      return Response.json(
        { joined: false, key: input.key, status: 'accepted' },
        { status: 202 }
      )
    }
    return refused(request)
  }

  override async onChatMessage(
    _onFinish: unknown,
    options?: OnChatMessageOptions
  ): Promise<Response> {
    const run = this.runs().find((r) => r.status === 'accepted')
    if (!run || this.state.revoked) throw new Error('No authorized accepted turn')
    this
      .sql`update prototype_runs set status='streaming',request_id=${options?.requestId ?? ''} where key=${run.key}`
    this.event('model-start', {
      key: run.key,
      requestId: options?.requestId,
      continuation: options?.continuation ?? false
    })
    this.stash({ key: run.key })
    const prompt = Prompt.make(
      this.messages.flatMap((message) => {
        const text = message.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('')
        if (message.role !== 'user' && message.role !== 'assistant') return []
        return [{ role: message.role, content: text }]
      })
    )
    const signal = AbortSignal.any([
      ...(options?.abortSignal ? [options.abortSignal] : []),
      ...(this.activeAbort ? [this.activeAbort.signal] : [])
    ])
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({
          type: 'start',
          messageId: `answer-${run.key}`,
          messageMetadata: {
            provider: 'prototype',
            model: 'deterministic-effect',
            submissionKey: run.key
          }
        })
        const consume = LanguageModel.streamText({ prompt, toolChoice: 'none' }).pipe(
          Stream.runForEach((part) =>
            Effect.sync(() => {
              if (this.state.revoked) throw new Error('Access revoked')
              switch (part.type) {
                case 'text-start':
                  writer.write({ type: 'text-start', id: part.id })
                  break
                case 'text-delta':
                  writer.write({ type: 'text-delta', id: part.id, delta: part.delta })
                  break
                case 'text-end':
                  writer.write({ type: 'text-end', id: part.id })
                  break
                case 'response-metadata':
                  writer.write({
                    type: 'message-metadata',
                    messageMetadata: { model: part.modelId }
                  })
                  break
                case 'finish':
                  writer.write({
                    type: 'finish',
                    finishReason: 'stop',
                    messageMetadata: {
                      provider: 'prototype',
                      model: 'deterministic-effect',
                      usage: part.usage
                    }
                  })
                  break
                default:
                  throw new Error(`Unsupported prototype part: ${part.type}`)
              }
            })
          ),
          Effect.catchTag('AiError', () =>
            Effect.sync(() => {
              this.finish(run.key, 'interrupted')
              this.event('typed-model-error', { key: run.key })
              writer.write({
                type: 'error',
                errorText: 'Prototype provider interrupted. Retry explicitly.'
              })
            })
          ),
          Effect.provide(modelFor(run))
        )
        try {
          await Effect.runPromise(consume, { signal })
        } catch (error) {
          if (signal.aborted) {
            writer.write({ type: 'abort' })
            this.event('effect-aborted', { key: run.key })
          } else throw error
        }
      },
      onError: () => 'Prototype stream interrupted'
    })
    return createUIMessageStreamResponse({ stream })
  }

  protected override async onChatRecovery(context: ChatRecoveryContext) {
    this.event('sdk-recovery', {
      partialLength: context.partialText.length,
      requestId: context.requestId,
      recoveryData: context.recoveryData
    })
    for (const run of this.runs().filter((r) =>
      ['accepted', 'streaming'].includes(r.status)
    ))
      this.finish(run.key, 'interrupted')
    return { continue: false }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/fixture/sign-in') {
      const actor = url.searchParams.get('member') === 'bob' ? 'bob' : 'alice'
      return new Response('Prototype identity selected', {
        headers: {
          'set-cookie': `prototype-session=prototype-member-${actor}; HttpOnly; SameSite=Strict; Path=/`
        }
      })
    }
    if (!url.pathname.startsWith('/c/')) return env.ASSETS.fetch(request)
    if (actorOf(request) !== 'alice') return refused(request)
    const name = url.pathname.split('/')[2]
    if (!name || !/^[a-z0-9-]{1,80}$/.test(name)) return refused(request)
    const stub = await getAgentByName(env.AssistantPrototype, name)
    if (
      !url.pathname.endsWith('/authority') &&
      !(await stub.canAccess(actorOf(request) ?? ''))
    )
      return refused(request)
    return stub.fetch(request)
  }
} satisfies ExportedHandler<Env>
