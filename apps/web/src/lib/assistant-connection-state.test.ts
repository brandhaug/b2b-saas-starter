import { describe, expect, it } from 'vite-plus/test'
import { connectionTransition, type Connection } from './assistant-connection-state'

const fresh: Connection = { status: 'connecting', observer: 0 }

describe('connectionTransition', () => {
  it('starts a fresh observer connecting and a later generation reconnecting', () => {
    expect(
      connectionTransition(fresh, { type: 'start', observer: 1, reconnecting: false })
    ).toEqual({ status: 'connecting', observer: 1 })
    expect(
      connectionTransition(fresh, { type: 'start', observer: 2, reconnecting: true })
    ).toEqual({ status: 'reconnecting', observer: 2 })
  })

  it('connects on open and falls back to reconnecting on close', () => {
    const connecting = connectionTransition(fresh, {
      type: 'start',
      observer: 1,
      reconnecting: false
    })
    const connected = connectionTransition(connecting, {
      type: 'open',
      observer: 1
    })
    expect(connected).toEqual({ status: 'connected', observer: 1 })
    expect(connectionTransition(connected, { type: 'close', observer: 1 })).toEqual({
      status: 'reconnecting',
      observer: 1
    })
    expect(
      connectionTransition(connected, { type: 'open', observer: 1 })
    ).toMatchObject({ status: 'connected' })
  })

  it('ignores socket events from a stale observer', () => {
    const current = connectionTransition(fresh, {
      type: 'start',
      observer: 2,
      reconnecting: false
    })
    for (const event of [
      { type: 'open', observer: 1 },
      { type: 'close', observer: 1 },
      { type: 'deny', observer: 1, message: 'stale' }
    ] as const) {
      expect(connectionTransition(current, event)).toBe(current)
    }
  })

  it('denies with the refusal message and then ignores every event from that observer', () => {
    const connecting = connectionTransition(fresh, {
      type: 'start',
      observer: 3,
      reconnecting: false
    })
    const denied = connectionTransition(connecting, {
      type: 'deny',
      observer: 3,
      message: 'Access lost'
    })
    expect(denied).toEqual({ status: 'denied', observer: 3, message: 'Access lost' })
    for (const event of [
      { type: 'open', observer: 3 },
      { type: 'close', observer: 3 },
      { type: 'deny', observer: 3, message: 'again' }
    ] as const) {
      expect(connectionTransition(denied, event)).toBe(denied)
    }
  })

  it('lets a new observer start recover a denied connection', () => {
    const denied = connectionTransition(fresh, {
      type: 'start',
      observer: 3,
      reconnecting: false
    })
    const recovered = connectionTransition(denied, {
      type: 'start',
      observer: 4,
      reconnecting: true
    })
    expect(recovered).toEqual({ status: 'reconnecting', observer: 4 })
  })
})
