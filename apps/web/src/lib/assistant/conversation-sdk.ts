import { type AIChatAgent } from '@cloudflare/ai-chat'
import { type Connection } from 'agents'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import {
  allowedConversationRequest,
  decodeFrame,
  decodeObservation
} from './conversation-protocol'

type SocketAuthority = {
  readonly credential: AssistantCredentialReference
  readonly runAccessRevision: number
}

type Disclosure = {
  readonly connection: Connection
  readonly data: string
  readonly send: (data: string) => void
}

/**
 * AIChatAgent installs instance callbacks in its constructor. This is the sole
 * adapter that replaces them: sockets may observe, application HTTP owns writes,
 * and every SDK send passes through current-authority disclosure batching.
 */
export function installConversationProtocol(
  host: Pick<
    AIChatAgent<Env>,
    'fetch' | 'onRequest' | 'onConnect' | 'onMessage' | 'broadcast' | 'getConnections'
  >,
  ports: {
    readonly request: (request: Request) => Promise<Response>
    readonly upgrade: (
      request: Request,
      next: () => Promise<Response>
    ) => Promise<Response>
    readonly connect: (request: Request) => Promise<SocketAuthority>
    readonly authorize: (connection: Connection) => Promise<void>
    readonly connected: (
      connection: Connection,
      authority: SocketAuthority
    ) => Promise<void>
    readonly disclose: (frame: Disclosure) => void
    readonly changed: () => void
  }
) {
  const guarded = new WeakSet<Connection>()
  function guard(connection: Connection) {
    if (guarded.has(connection)) {
      return
    }
    guarded.add(connection)
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
      ports.disclose({ connection, data: frame.success, send })
    }
  }
  const fetch = host.fetch.bind(host)
  const connect = host.onConnect.bind(host)
  const message = host.onMessage.bind(host)
  host.fetch = async (request) => {
    if (!allowedConversationRequest(request)) {
      return new Response(null, { status: 404 })
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return fetch(request)
    }
    return ports.upgrade(request, () => fetch(request))
  }
  host.onRequest = ports.request
  host.onConnect = (connection, context) =>
    ports
      .connect(context.request)
      .then(async (authority) => {
        connection.setState(authority)
        guard(connection)
        await connect(connection, context)
        return ports.connected(connection, authority)
      })
      .catch(() => connection.close(1008, 'Access unavailable'))
  host.onMessage = (connection, frame) => {
    guard(connection)
    return ports
      .authorize(connection)
      .then(async () => {
        if (decodeObservation(frame)._tag === 'Success') {
          await message(connection, frame)
        }
        return
      })
      .catch(() => connection.close(1008, 'Access unavailable'))
  }
  host.broadcast = (data, without) => {
    const excluded = new Set(without)
    for (const connection of host.getConnections()) {
      if (excluded.has(connection.id)) {
        continue
      }
      guard(connection)
      connection.send(data)
    }
    ports.changed()
  }
  return {
    send: (connection: Connection, data: string) => {
      guard(connection)
      connection.send(data)
    }
  }
}
