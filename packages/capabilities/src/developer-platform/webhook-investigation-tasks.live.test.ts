import { Effect } from 'effect'
import { expect, layer } from '@effect/vitest'

import { WebhookInvestigationTasks } from './webhook-investigation-tasks.ts'
import {
  prepareInvestigationDelivery,
  webhookInvestigationTaskContractCases
} from './webhook-investigation-tasks.contract.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'

const bindings = {
  webhookQueue: {
    send: () => Promise.resolve(),
    sendBatch: () => Promise.resolve()
  }
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live webhook investigation tasks',
  (it) => {
    for (const contractCase of webhookInvestigationTaskContractCases(expect)) {
      it.effect(contractCase.name, () =>
        inWorkspace(
          'dev-contract-lab',
          contractCase.assert,
          { userId: 'usr_owner' },
          bindings
        )
      )
    }

    it.effect('persists a task across separate workspace service calls', () =>
      Effect.gen(function* () {
        const taskId = yield* inWorkspace(
          'dev-contract-lab',
          Effect.gen(function* () {
            const source = yield* prepareInvestigationDelivery(
              'live-persistence',
              'dead_lettered'
            )
            const tasks = yield* WebhookInvestigationTasks
            const task = yield* tasks.create({
              deliveryId: source.deliveryId,
              question: 'Can a later request find this task?'
            })
            return task.id
          }),
          { userId: 'usr_owner' },
          bindings
        )

        const saved = yield* inWorkspace(
          'dev-contract-lab',
          Effect.flatMap(WebhookInvestigationTasks, (tasks) => tasks.get({ taskId })),
          { userId: 'usr_owner' },
          bindings
        )
        expect(saved).toMatchObject({
          id: taskId,
          question: 'Can a later request find this task?',
          status: 'proposed',
          diagnosis: 'receiver_unavailable'
        })
      })
    )
  }
)
