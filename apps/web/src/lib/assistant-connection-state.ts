/**
 * The connection machine for one observing tab of an assistant conversation
 * (ADR 0077 keeps UI machines hand-rolled pure reducers). The hook owns the
 * socket lifetime and query cache; this module owns only the four connection
 * labels and their fencing.
 */

export type Connection =
  | {
      readonly status: 'connecting' | 'connected' | 'reconnecting'
      readonly observer: number
    }
  | { readonly status: 'denied'; readonly observer: number; readonly message: string }

export type ConnectionEvent =
  | {
      readonly type: 'start'
      readonly observer: number
      readonly reconnecting: boolean
    }
  | { readonly type: 'open' | 'close'; readonly observer: number }
  | { readonly type: 'deny'; readonly observer: number; readonly message: string }

/**
 * Applies one socket or lifecycle event. `start` installs a fresh observer
 * epoch and always wins; every other event is fenced to the current observer
 * and ignored once the connection is denied.
 */
export function connectionTransition(
  state: Connection,
  event: ConnectionEvent
): Connection {
  if (event.type === 'start') {
    return {
      observer: event.observer,
      status: event.reconnecting ? 'reconnecting' : 'connecting'
    }
  }
  if (event.observer !== state.observer || state.status === 'denied') {
    return state
  }
  if (event.type === 'deny') {
    return { status: 'denied', observer: event.observer, message: event.message }
  }
  return {
    observer: event.observer,
    status: event.type === 'open' ? 'connected' : 'reconnecting'
  }
}
