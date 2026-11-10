import { WebhookDeliveryId } from '@b2b-saas-starter/db/ids'
import { webhookInvestigationTaskStatuses } from '@b2b-saas-starter/db/enums'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { selectWorkspaceLayer } from '../runtime.ts'
import { webhookInvestigationTaskContractCases } from './webhook-investigation-tasks.contract.ts'
import {
  initialInvestigationTaskStatus,
  investigationReplayOutcome,
  nextInvestigationTaskStatus,
  proposedInvestigationTaskStatus,
  WebhookInvestigationTasks
} from './webhook-investigation-tasks.ts'

describe('investigation task transition map', () => {
  it('claims a proposal as approved or cancelled', () => {
    expect(nextInvestigationTaskStatus('proposed', { kind: 'approve' })).toBe(
      'approved'
    )
    expect(nextInvestigationTaskStatus('proposed', { kind: 'cancel' })).toBe(
      'cancelled'
    )
  })

  it('re-enters approved idempotently and never cancels an approved task', () => {
    expect(nextInvestigationTaskStatus('approved', { kind: 'approve' })).toBe(
      'approved'
    )
    expect(nextInvestigationTaskStatus('approved', { kind: 'cancel' })).toBeNull()
  })

  it('refuses both outcomes from the terminal statuses', () => {
    for (const status of ['cancelled', 'completed'] as const) {
      expect(nextInvestigationTaskStatus(status, { kind: 'approve' })).toBeNull()
      expect(nextInvestigationTaskStatus(status, { kind: 'cancel' })).toBeNull()
    }
  })

  it('births a proposal only for an unavailable receiver', () => {
    expect(initialInvestigationTaskStatus('receiver_unavailable')).toBe('proposed')
    for (const diagnosis of [
      'retrying',
      'delivered',
      'receiver_rejected',
      'endpoint_disabled',
      'unknown'
    ] as const) {
      expect(initialInvestigationTaskStatus(diagnosis)).toBe('completed')
    }
  })

  it('pins the only status a stored transition may claim from', () => {
    expect(proposedInvestigationTaskStatus).toBe('proposed')
    // Compile-time exhaustiveness plus a runtime guard for the test itself.
    expect(webhookInvestigationTaskStatuses).toContain('approved')
  })
})

describe('investigation replay outcome', () => {
  it("reads the outcome through the delivery owner's vocabulary", () => {
    expect(investigationReplayOutcome(null)).toBe('unavailable')
    expect(investigationReplayOutcome('delivered')).toBe('delivered')
    // Dispatchable deliveries are still in flight; the outcome waits.
    expect(investigationReplayOutcome('pending')).toBe('pending')
    expect(investigationReplayOutcome('failed')).toBe('pending')
    expect(investigationReplayOutcome('failed_permanent')).toBe('failed')
    expect(investigationReplayOutcome('dead_lettered')).toBe('failed')
  })
})

describe('webhook investigation tasks', () => {
  it.effect(
    'saves evidence and an exact replay proposal for an exhausted delivery',
    () =>
      Effect.gen(function* () {
        const tasks = yield* WebhookInvestigationTasks
        const task = yield* tasks.create({
          deliveryId: WebhookDeliveryId.make('whd_seed_dead_lettered'),
          question: 'Why did this fail?'
        })
        const saved = yield* tasks.get({ taskId: task.id })
        expect(saved.question).toBe('Why did this fail?')
        expect(saved.status).toBe('proposed')
        expect(saved.evidence.lastResponseStatus).toBe(503)
        expect(saved.evidence.attempts.length).toBeGreaterThan(0)
        expect(saved.replayDeliveryId).toBeNull()
      }).pipe(
        Effect.provide(
          selectWorkspaceLayer({}, 'starter-lab', { userId: 'usr_demo' }, 'user')
        )
      )
  )
})

describe('seed webhook investigation tasks contract', () => {
  for (const contractCase of webhookInvestigationTaskContractCases(expect)) {
    it.effect(contractCase.name, () =>
      contractCase.assert.pipe(
        Effect.provide(
          selectWorkspaceLayer({}, 'starter-lab', { userId: 'usr_demo' }, 'user')
        )
      )
    )
  }
})
