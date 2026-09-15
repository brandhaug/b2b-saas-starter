import { Deferred, Effect } from 'effect'
import { type AgentContext } from 'agents'
import { WorkspaceAssistantConversation as ConversationHost } from '../../src/lib/assistant/conversation-host'

/** Deterministic storage barrier exists only in this test Worker. */
export class WorkspaceAssistantConversation extends ConversationHost {
  private persistenceGate: Deferred.Deferred<boolean> | undefined
  private persistenceWaiting = false

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env)
    const fetch = this.fetch.bind(this)
    this.fetch = async (request) => {
      const action = new URL(request.url).pathname.split('/').at(-1)
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
