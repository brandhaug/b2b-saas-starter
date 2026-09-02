import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import {
  fakeUserAdminBinding,
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { platformUserAdminContractCases } from './platform-user-admin.contract.ts'

// The Seed half of this same list runs in index.test.ts.
layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live platform user admin',
  (it) => {
    describe('live platform user admin contract', () => {
      for (const contractCase of platformUserAdminContractCases(
        {
          existing: 'usr_owner',
          outsider: 'usr_outsider',
          unknown: 'usr_nobody',
          workspaceId: 'wrk_user_admin_contract'
        },
        expect
      )) {
        it.effect(contractCase.name, () =>
          Effect.gen(function* () {
            const db = yield* Database
            const binding = fakeUserAdminBinding(db)
            yield* inWorkspace(
              'live-lab',
              contractCase.assert,
              { userId: 'usr_owner' },
              { userAdminBinding: binding }
            )
          })
        )
      }
    })
  }
)
