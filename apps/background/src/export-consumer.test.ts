import {
  WORKSPACE_EXPORT_RETENTION_DAYS as CAPABILITY_RETENTION_DAYS,
  workspaceExportExpiresAt,
  WorkspaceExportQueueMessage
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { describe, expect, it } from '@effect/vitest'
import { DateTime } from 'effect'

import { WORKSPACE_EXPORT_RETENTION_DAYS } from '@b2b-saas-starter/infra'
import { readDelivery } from './queue-consumer.ts'

const message: WorkspaceExportQueueMessage = {
  exportId: 'exp_1',
  workspaceId: 'wrk_1',
  workspaceSlug: 'lab'
}

describe('readDelivery', () => {
  it('decodes the producer schema, traceparent included', () => {
    const delivery = readDelivery(WorkspaceExportQueueMessage, {
      id: 'qmsg_1',
      body: { ...message, traceparent: '00-abc-def-01' },
      attempts: 2
    })
    expect(delivery.kind).toBe('message')
    expect(delivery.id).toBe('qmsg_1')
    expect(delivery.attempts).toBe(2)
  })

  it('names a body that misses the workspace slug malformed', () => {
    expect(
      readDelivery(WorkspaceExportQueueMessage, {
        id: 'qmsg_2',
        body: { exportId: 'x', workspaceId: 'y' },
        attempts: 1
      })
    ).toEqual({ id: 'qmsg_2', attempts: 1, kind: 'malformed' })
  })
})

describe('retention horizon', () => {
  it('keeps the bucket lifecycle rule and the row expiry on one number', () => {
    // `infra/bindings.ts` drives the R2 lifecycle rule; the capability stamps
    // `expiresAt`. Neither imports the other, so this is where they meet — and
    // the horizon itself is pinned, so moving both declarations together still
    // fails this test.
    expect(CAPABILITY_RETENTION_DAYS).toBe(WORKSPACE_EXPORT_RETENTION_DAYS)
    expect(WORKSPACE_EXPORT_RETENTION_DAYS).toBe(7)
  })

  it('expires a ready export seven days after it completed', () => {
    // The horizon the capability stamps, against a literal date rather than a
    // second copy of its own arithmetic.
    expect(
      workspaceExportExpiresAt(DateTime.makeUnsafe('2026-09-03T08:00:00.000Z'))
    ).toBe('2026-09-10T08:00:00.000Z')
  })
})
