import { Effect } from 'effect'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import {
  AccountLifecycle,
  type AccountDeletionPlan
} from '@b2b-saas-starter/capabilities/governance/account-lifecycle'

import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { type NotificationPreferenceRow } from './notification-preferences'
import { notificationPreferencesPayload } from './notification-preferences.effects'
import {
  PersonalDataExports,
  renderPersonalDataExport
} from '@b2b-saas-starter/capabilities/governance/personal-data-export'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { requireRecentAuthentication } from './strong-authentication.effects'

/**
 * The `/account` page's server reads, testable against the Seed layer like
 * `loadWorkspaceDashboardHandler`. The route reaches them through
 * `loadAccountPageServerFn` (in the client-safe `account.ts`), whose handler
 * imports this module dynamically; the delete is a server fn whose handler
 * lives in `account-delete.ts`, reached the same way.
 *
 * This surface is user-level, not workspace-level: no `WorkspaceContext`, no
 * workspace permission gate — the ownership rule lives in the capability, and
 * the only authorization question ("is this the account owner?") is the
 * session itself.
 */

/** The page payload: what deleting the account would do to each workspace. */
export type AccountPagePayload = {
  readonly deletionPlan: AccountDeletionPlan
}

/** The `/account` route's loader read: the handler the loader server fn delegates to. */
export async function loadAccountPageHandler(): Promise<
  AccountPagePayload & {
    readonly preferences: ReadonlyArray<NotificationPreferenceRow>
  }
> {
  // The deletion plan and the user's notification preferences — two
  // identity-keyed reads with no workspace involved, run as one capability
  // effect (`Effect.all`, the same composition the workspace settings
  // payload uses for its segments). The session keys both reads.
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.map(
      Effect.all(
        {
          deletionPlan: Effect.flatMap(AccountLifecycle, (lifecycle) =>
            lifecycle.planDeletion(session.user.id)
          ),
          preferenceRows: Effect.map(
            notificationPreferencesPayload({
              userId: session.user.id,
              locale: getLocale()
            }),
            (payload) => payload.preferences
          )
        },
        { concurrency: 'unbounded' }
      ),
      ({ deletionPlan, preferenceRows }) => ({
        deletionPlan,
        preferences: preferenceRows
      })
    )
  )
}

export async function exportPersonalDataHandler(): Promise<{
  readonly fileName: string
  readonly json: string
}> {
  const session = await requireRequestSession()
  await requireRecentAuthentication(session)
  const data = await runCapabilities(
    Effect.gen(function* () {
      const exports = yield* PersonalDataExports
      const result = yield* exports.collect(session.user.id)
      const audit = yield* AuditEventLog
      yield* audit.record({
        actorUserId: session.user.id,
        actorType: 'user',
        eventType: 'auth.personal_data_exported',
        targetType: 'user',
        targetId: session.user.id,
        metadata: {}
      })
      return result
    })
  )
  return {
    fileName: `personal-data-${session.user.id}.json`,
    json: renderPersonalDataExport(data)
  }
}
