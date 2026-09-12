import { workspaceViewSearch } from '@/lib/workspace-view'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { loadWorkspaceSuspensionServerFn } from '@/lib/server/workspace-suspension'

/**
 * Membership-safe suspension and privileged-authentication gate for every
 * route mounted under a workspace. It runs before child loaders, so neither a
 * suspended workspace nor an unverified privileged session starts an ordinary
 * page read on either SSR or client navigation.
 */
export const Route = createFileRoute('/workspaces/$workspaceSlug')({
  validateSearch: workspaceViewSearch,
  beforeLoad: async ({ params, location }) => {
    const suspension = await loadWorkspaceSuspensionServerFn({
      data: { workspaceSlug: params.workspaceSlug }
    })
    const recoveryPath = `/workspaces/${encodeURIComponent(params.workspaceSlug)}/suspended`
    const onRecoveryPath = location.pathname === recoveryPath
    if (suspension.status === 'suspended' && !onRecoveryPath) {
      throw redirect({
        to: '/workspaces/$workspaceSlug/suspended',
        params: { workspaceSlug: params.workspaceSlug }
      })
    }
    if (suspension.status === 'active' && onRecoveryPath) {
      throw redirect({
        to: '/workspaces/$workspaceSlug',
        params: { workspaceSlug: params.workspaceSlug }
      })
    }
    // An owner or admin whose session has not proven itself recently is sent
    // to verify, as a redirect: the gate is a page the actor can act on, not
    // a failed page read behind an error boundary. `redirect` carries the
    // location they asked for, so verifying returns them to it. Deliberately
    // the whole subtree, so the actor verifies once at the boundary rather
    // than meeting the gate halfway through a page; members are never asked.
    // The recovery path is exempt because it maps to the
    // `credential_recovery` operation, which repairs a workspace the actor
    // may not be able to verify from.
    if (suspension.strongAuthenticationRequired && !onRecoveryPath) {
      throw redirect({
        to: '/verify-authentication',
        search: { redirect: location.href }
      })
    }
    return { suspension }
  },
  component: Outlet
})
