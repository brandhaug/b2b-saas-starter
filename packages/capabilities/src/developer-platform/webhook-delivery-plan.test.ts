import {
  ApiTokenId,
  WebhookDeliveryId,
  WebhookEndpointId
} from '@b2b-saas-starter/db/ids'
import { DateTime } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import {
  activeSigningSecrets,
  classifyResponseStatus,
  deadLetteredDeliveryStatus,
  deliveredDeliveryStatus,
  dispatchableDeliveryStatuses,
  failedDeliveryStatus,
  failedPermanentDeliveryStatus,
  failureLadderAction,
  failureLadderNotification,
  isDispatchableDeliveryStatus,
  isReplayableDeliveryStatus,
  isSettledDeliveryStatus,
  isTerminalDeliveryStatus,
  nextConsecutiveFailures,
  nextWebhookDeliveryStatus,
  pendingDeliveryStatus,
  planReplayedDelivery,
  planSecretRotation,
  replayableDeliveryStatuses,
  settledDeliveryStatuses,
  terminalDeliveryStatuses,
  truncateResponseBody,
  RESPONSE_BODY_MAX_LENGTH,
  backoffSeconds,
  planDeliveryAttempt,
  type FailureLadderAction,
  type WebhookDeliveryStatus,
  WEBHOOK_FAILURE_AUTO_DISABLE_AT
} from './webhook-delivery-plan.ts'
import { deliveryStatuses } from '@b2b-saas-starter/db/enums'

const now = DateTime.makeUnsafe('2026-09-01T12:00:00.000Z')
const hourLater = DateTime.makeUnsafe('2026-09-01T13:00:00.000Z')
const dayLater = DateTime.makeUnsafe('2026-09-02T12:00:00.000Z')

describe('replay plan', () => {
  const source = {
    id: WebhookDeliveryId.make('whd_original'),
    endpointId: WebhookEndpointId.make('wh_release'),
    eventType: 'api_token.created',
    payload: { tokenId: ApiTokenId.make('tok_docs') }
  }

  it('resets attempts and starts pending on a new row', () => {
    expect(planReplayedDelivery(source)).toMatchObject({
      endpointId: WebhookEndpointId.make('wh_release'),
      eventType: 'api_token.created',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      responseStatus: null
    })
  })

  it('carries the original payload verbatim and links back with replayedFrom', () => {
    const plan = planReplayedDelivery(source)
    expect(plan.payload).toEqual({ tokenId: ApiTokenId.make('tok_docs') })
    expect(plan.replayedFrom).toBe(WebhookDeliveryId.make('whd_original'))
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

describe('delivery transition map', () => {
  function dispatch(decision: 'delivered' | 'retry' | 'terminal') {
    return { kind: 'dispatch', decision } as const
  }

  it('moves a pending row to the dispatched outcome', () => {
    expect(nextWebhookDeliveryStatus('pending', dispatch('delivered'))).toBe(
      'delivered'
    )
    expect(nextWebhookDeliveryStatus('pending', dispatch('retry'))).toBe('failed')
    expect(nextWebhookDeliveryStatus('pending', dispatch('terminal'))).toBe(
      'failed_permanent'
    )
  })

  it('accepts the same dispatch outcomes from a retrying row', () => {
    expect(nextWebhookDeliveryStatus('failed', dispatch('delivered'))).toBe('delivered')
    expect(nextWebhookDeliveryStatus('failed', dispatch('retry'))).toBe('failed')
    expect(nextWebhookDeliveryStatus('failed', dispatch('terminal'))).toBe(
      'failed_permanent'
    )
  })

  it('dead-letters a dispatchable row whose attempts are exhausted', () => {
    expect(nextWebhookDeliveryStatus('pending', { kind: 'attempts_exhausted' })).toBe(
      'dead_lettered'
    )
    expect(nextWebhookDeliveryStatus('failed', { kind: 'attempts_exhausted' })).toBe(
      'dead_lettered'
    )
  })

  it('settles an untouched pending row whose enqueue confirmation failed', () => {
    expect(nextWebhookDeliveryStatus('pending', { kind: 'enqueue_failure' })).toBe(
      'failed_permanent'
    )
  })

  it('refuses the enqueue-failure edge from every other status', () => {
    // The confirmation covers the original enqueue only; a row the queue
    // already dispatched fails through dispatch or exhaustion instead.
    expect(nextWebhookDeliveryStatus('failed', { kind: 'enqueue_failure' })).toBeNull()
    expect(
      nextWebhookDeliveryStatus('failed_permanent', { kind: 'enqueue_failure' })
    ).toBeNull()
  })

  it('refuses every transition out of the terminal statuses', () => {
    for (const status of ['delivered', 'failed_permanent', 'dead_lettered'] as const) {
      expect(nextWebhookDeliveryStatus(status, dispatch('delivered'))).toBeNull()
      expect(nextWebhookDeliveryStatus(status, dispatch('retry'))).toBeNull()
      expect(nextWebhookDeliveryStatus(status, dispatch('terminal'))).toBeNull()
      expect(
        nextWebhookDeliveryStatus(status, { kind: 'attempts_exhausted' })
      ).toBeNull()
      expect(nextWebhookDeliveryStatus(status, { kind: 'enqueue_failure' })).toBeNull()
    }
  })

  it('agrees with the classification the dispatch plan persists', () => {
    // `planDeliveryAttempt` derives the stored status; the map must answer
    // the same target for both dispatchable statuses.
    const byDecision = new Map([
      ['delivered', 200],
      ['retry', 503],
      ['terminal', 404]
    ] as const)
    for (const [decision, responseStatus] of byDecision) {
      const planned = planDeliveryAttempt(responseStatus, 1, now).status
      expect(nextWebhookDeliveryStatus('pending', { kind: 'dispatch', decision })).toBe(
        planned
      )
      expect(nextWebhookDeliveryStatus('failed', { kind: 'dispatch', decision })).toBe(
        planned
      )
    }
  })

  it('covers the stored vocabulary exhaustively', () => {
    // Compile-time exhaustiveness plus a runtime guard for the test itself.
    expect(deliveryStatuses).toContain('dead_lettered')
  })
})

describe('delivery predicate sets', () => {
  it('admits exactly pending and failed as dispatchable', () => {
    expect(dispatchableDeliveryStatuses).toEqual(['pending', 'failed'])
    for (const status of deliveryStatuses) {
      expect(isDispatchableDeliveryStatus(status)).toBe(
        status === 'pending' || status === 'failed'
      )
    }
  })

  it('serves exactly the terminal outcomes to the admin read', () => {
    expect(terminalDeliveryStatuses).toEqual(['failed_permanent', 'dead_lettered'])
    for (const status of deliveryStatuses) {
      expect(isTerminalDeliveryStatus(status)).toBe(
        status === 'failed_permanent' || status === 'dead_lettered'
      )
    }
  })

  it('settles delivered and terminal rows only', () => {
    expect(settledDeliveryStatuses).toEqual([
      'delivered',
      'failed_permanent',
      'dead_lettered'
    ])
    for (const status of deliveryStatuses) {
      expect(isSettledDeliveryStatus(status)).toBe(
        status !== 'pending' && status !== 'failed'
      )
    }
  })

  it('names the single statuses the adapters compose SQL from', () => {
    const named: Record<WebhookDeliveryStatus, WebhookDeliveryStatus> = {
      pending: pendingDeliveryStatus,
      delivered: deliveredDeliveryStatus,
      failed: failedDeliveryStatus,
      failed_permanent: failedPermanentDeliveryStatus,
      dead_lettered: deadLetteredDeliveryStatus
    }
    expect(Object.values(named).toSorted()).toEqual([...deliveryStatuses].toSorted())
  })

  it('keeps replay legal only from the failure vocabulary, as a new row', () => {
    expect(replayableDeliveryStatuses).toEqual([
      'failed',
      'failed_permanent',
      'dead_lettered'
    ])
    // A replay never moves its source: the plan births a fresh pending row.
    const replay = planReplayedDelivery({
      id: WebhookDeliveryId.make('whd_source'),
      endpointId: WebhookEndpointId.make('wh_src'),
      eventType: 'api_token.created',
      payload: {}
    })
    expect(replay.status).toBe('pending')
    expect(replay.replayedFrom).toBe(WebhookDeliveryId.make('whd_source'))
  })
})

describe('secret rotation grace', () => {
  it('schedules the replaced secret to expire exactly 24 hours out', () => {
    expect(planSecretRotation(now)).toBe('2026-09-02T12:00:00.000Z')
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

describe('failure ladder', () => {
  it('climbs on every failure vocabulary entry and resets only on delivered', () => {
    expect(nextConsecutiveFailures(4, 'failed')).toBe(5)
    expect(nextConsecutiveFailures(4, 'failed_permanent')).toBe(5)
    expect(nextConsecutiveFailures(4, 'dead_lettered')).toBe(5)
    expect(nextConsecutiveFailures(19, 'delivered')).toBe(0)
    expect(nextConsecutiveFailures(0, 'delivered')).toBe(0)
  })

  it('warns exactly at 5, 10, and 15 and disables from 20 on — silent elsewhere', () => {
    // The ladder's whole policy in one oracle: rungs fire once per climb
    // (exact matches), the threshold is a floor that stays reached past 20,
    // and every other streak escalates nothing.
    const expected = new Map<number, FailureLadderAction>([
      [5, 'warn'],
      [10, 'warn'],
      [15, 'warn'],
      [20, 'disable'],
      [21, 'disable']
    ])
    for (let streak = 0; streak <= WEBHOOK_FAILURE_AUTO_DISABLE_AT + 1; streak++) {
      expect(failureLadderAction(streak)).toBe(expected.get(streak) ?? 'silent')
    }
  })

  it('warns with the streak and the coming threshold, naming the endpoint', () => {
    const copy = failureLadderNotification({
      url: 'https://example.com/hook',
      consecutiveFailures: 5
    })
    expect(copy.title).toBe('Webhook endpoint failing')
    expect(copy.message).toContain('https://example.com/hook')
    expect(copy.message).toContain('5 deliveries in a row')
    expect(copy.message).toContain('20')
  })

  it('names the disable and the one way back at the threshold', () => {
    const copy = failureLadderNotification({
      url: 'https://example.com/hook',
      consecutiveFailures: 20
    })
    expect(copy.title).toBe('Webhook endpoint auto-disabled')
    expect(copy.message).toContain('disabled')
    expect(copy.message).toContain('Re-enable')
  })

  it('falls back to a generic target when the URL is unknown', () => {
    const copy = failureLadderNotification({ url: null, consecutiveFailures: 10 })
    expect(copy.message).toContain('A webhook endpoint')
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
