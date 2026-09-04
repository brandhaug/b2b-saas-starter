import { DateTime } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import {
  activeSigningSecrets,
  planReplayedDelivery,
  planSecretRotation,
  truncateResponseBody,
  RESPONSE_BODY_MAX_LENGTH,
  isReplayableDeliveryStatus,
  backoffSeconds,
  classifyResponseStatus,
  planDeliveryAttempt
} from './webhook-delivery-plan.ts'

const now = DateTime.makeUnsafe('2026-09-01T12:00:00.000Z')
const hourLater = DateTime.makeUnsafe('2026-09-01T13:00:00.000Z')
const dayLater = DateTime.makeUnsafe('2026-09-02T12:00:00.000Z')

describe('replay plan', () => {
  const source = {
    id: 'whd_original',
    endpointId: 'wh_release',
    eventType: 'api_token.created',
    payload: { tokenId: 'tok_docs' }
  }

  it('resets attempts and starts pending on a new row', () => {
    expect(planReplayedDelivery(source)).toMatchObject({
      endpointId: 'wh_release',
      eventType: 'api_token.created',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      responseStatus: null
    })
  })

  it('carries the original payload verbatim and links back with replayedFrom', () => {
    const plan = planReplayedDelivery(source)
    expect(plan.payload).toEqual({ tokenId: 'tok_docs' })
    expect(plan.replayedFrom).toBe('whd_original')
  })

  it('leaves the source row identity out of the plan — adapters own ids and clocks', () => {
    const plan = planReplayedDelivery(source)
    expect(Object.hasOwn(plan, 'id')).toBe(false)
    expect(Object.hasOwn(plan, 'workspaceId')).toBe(false)
  })
})

describe('replayable statuses', () => {
  it('replays failures only', () => {
    expect(isReplayableDeliveryStatus('failed')).toBe(true)
    expect(isReplayableDeliveryStatus('failed_permanent')).toBe(true)
    expect(isReplayableDeliveryStatus('dead_lettered')).toBe(true)
    expect(isReplayableDeliveryStatus('delivered')).toBe(false)
    expect(isReplayableDeliveryStatus('pending')).toBe(false)
  })
})

describe('secret rotation grace', () => {
  it('schedules the replaced secret to expire exactly 24 hours out', () => {
    expect(planSecretRotation(now).previousSecretExpiresAt).toBe(
      '2026-09-02T12:00:00.000Z'
    )
  })

  it('signs with the current secret alone when nothing was rotated', () => {
    expect(activeSigningSecrets({ signingSecret: 'whsec_current' }, now)).toEqual([
      'whsec_current'
    ])
  })

  it('dual-signs while the grace window is open', () => {
    const rotation = {
      signingSecret: 'whsec_current',
      previousSigningSecret: 'whsec_previous',
      previousSecretExpiresAt: '2026-09-02T12:00:00.000Z'
    }
    expect(activeSigningSecrets(rotation, hourLater)).toEqual([
      'whsec_current',
      'whsec_previous'
    ])
    // One second before the boundary the old secret still signs.
    expect(
      activeSigningSecrets(rotation, DateTime.makeUnsafe('2026-09-02T11:59:59.000Z'))
    ).toEqual(['whsec_current', 'whsec_previous'])
  })

  it('stops signing with the previous secret at the expiry instant', () => {
    // The window is [rotatedAt, expiresAt): the boundary itself is closed, so
    // "valid for 24 hours" cannot quietly stretch to 24h + ε.
    expect(
      activeSigningSecrets(
        {
          signingSecret: 'whsec_current',
          previousSigningSecret: 'whsec_previous',
          previousSecretExpiresAt: '2026-09-02T12:00:00.000Z'
        },
        dayLater
      )
    ).toEqual(['whsec_current'])
  })

  it('treats a missing expiry or secret as no grace, not as an eternal one', () => {
    expect(
      activeSigningSecrets(
        { signingSecret: 'whsec_current', previousSigningSecret: 'whsec_previous' },
        now
      )
    ).toEqual(['whsec_current'])
    expect(
      activeSigningSecrets(
        { signingSecret: 'whsec_current', previousSecretExpiresAt: 'bogus' },
        now
      )
    ).toEqual(['whsec_current'])
  })
})

describe('response body evidence', () => {
  it('stores short bodies verbatim', () => {
    expect(truncateResponseBody('upstream connect error')).toBe(
      'upstream connect error'
    )
  })

  it('cuts long bodies with a visible marker', () => {
    const body = 'x'.repeat(RESPONSE_BODY_MAX_LENGTH + 100)
    const stored = truncateResponseBody(body)
    expect(stored.length).toBeLessThan(body.length)
    expect(stored.endsWith('… [truncated]')).toBe(true)
    expect(stored.startsWith('x')).toBe(true)
  })
})

describe('backoff schedule (unchanged contract)', () => {
  it('backs off linearly at 30s per attempt', () => {
    expect(backoffSeconds(1)).toBe(30)
    expect(backoffSeconds(2)).toBe(60)
    expect(backoffSeconds(5)).toBe(150)
  })

  it('still caps at 180s beyond six attempts', () => {
    expect(backoffSeconds(6)).toBe(180)
    expect(backoffSeconds(9)).toBe(180)
  })
})

// Cases the background worker's test file carried before its
// capability-logic describes were deleted from it — the policy lives here,
// so its coverage lives here too.
describe('classifyResponseStatus', () => {
  it('acks 2xx as delivered', () => {
    expect(classifyResponseStatus(200)).toBe('delivered')
    expect(classifyResponseStatus(204)).toBe('delivered')
  })

  it('treats permanent 4xx as terminal (ack, no retry)', () => {
    expect(classifyResponseStatus(400)).toBe('terminal')
    expect(classifyResponseStatus(404)).toBe('terminal')
  })

  it('retries 408, 429, 5xx, and no-response (0)', () => {
    expect(classifyResponseStatus(408)).toBe('retry')
    expect(classifyResponseStatus(429)).toBe('retry')
    expect(classifyResponseStatus(500)).toBe('retry')
    expect(classifyResponseStatus(503)).toBe('retry')
    expect(classifyResponseStatus(0)).toBe('retry')
  })
})

describe('planDeliveryAttempt', () => {
  it('acks a delivered attempt with no next attempt', () => {
    expect(planDeliveryAttempt(200, 1, now)).toEqual({
      status: 'delivered',
      responseStatus: 200,
      nextAttemptAt: null,
      outcome: 'ack'
    })
  })

  it('acks a permanent 4xx as failed_permanent', () => {
    expect(planDeliveryAttempt(410, 1, now)).toEqual({
      status: 'failed_permanent',
      responseStatus: 410,
      nextAttemptAt: null,
      outcome: 'ack'
    })
  })

  it('retries with linear backoff from the attempt count', () => {
    expect(planDeliveryAttempt(500, 2, now)).toEqual({
      status: 'failed',
      responseStatus: 500,
      nextAttemptAt: '2026-09-01T12:01:00.000Z',
      outcome: 'retry'
    })
  })

  it('records no status for a missing HTTP response', () => {
    expect(planDeliveryAttempt(0, 1, now)).toEqual({
      status: 'failed',
      responseStatus: null,
      nextAttemptAt: '2026-09-01T12:00:30.000Z',
      outcome: 'retry'
    })
  })
})
