// oxlint-disable effect/noAsyncFunction, effect/noNewPromise, effect/noThrowStatement, effect/noNewError -- this capability port is the Promise-shaped boundary into Better Auth's privileged endpoint; D1 binding absence is a deployment defect.

import { type D1Binding } from '@b2b-saas-starter/db/service'
import * as schema from '@b2b-saas-starter/db/schema'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'

import { type AccountLifecycleBinding } from './account-lifecycle.ts'

/**
 * Binding for Better Auth's privileged `admin/remove-user` endpoint.
 *
 * That endpoint has an administrator's session, while the lifecycle plan is
 * for the target account. Calling the session-bound organization endpoints
 * would therefore mutate the administrator's account. The endpoint has
 * already performed Better Auth's role check; this capability-owned adapter
 * applies the target membership/workspace teardown directly to D1.
 */
export function makeAdminAccountLifecycleBinding(
  database: D1Binding | undefined
): AccountLifecycleBinding {
  return {
    leaveWorkspace: async (input) => {
      const db = deletionDatabase(database)
      await db
        .delete(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.id, input.memberId),
            eq(schema.workspaceMembers.workspaceId, input.workspaceId)
          )
        )
    },
    deleteWorkspace: async (input) => {
      const db = deletionDatabase(database)
      await db
        .delete(schema.workspaces)
        .where(eq(schema.workspaces.id, input.workspaceId))
    },
    deleteUser: () => {
      // The admin endpoint owns the user-row delete. This binding only supplies
      // pre-delete workspace teardown; reaching this method is a wiring error.
      return Promise.reject(
        new Error('admin account binding cannot delete the user row')
      )
    }
  }
}

function deletionDatabase(database: D1Binding | undefined) {
  if (database === undefined) {
    throw new Error('admin account deletion requires the D1 binding')
  }
  return drizzle(database)
}
