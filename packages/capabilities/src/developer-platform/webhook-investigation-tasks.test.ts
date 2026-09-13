import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { selectWorkspaceLayer } from '../runtime.ts'
import { webhookInvestigationTaskContractCases } from './webhook-investigation-tasks.contract.ts'
import { WebhookInvestigationTasks } from './webhook-investigation-tasks.ts'

describe('webhook investigation tasks', () => {
  it.effect(
    'saves evidence and an exact replay proposal for an exhausted delivery',
    () =>
      Effect.gen(function* () {
        const tasks = yield* WebhookInvestigationTasks
        const task = yield* tasks.create({
          deliveryId: 'whd_seed_dead_lettered',
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
