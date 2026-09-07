import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { loadWorkspaceSuspensionServerFn } from '@/lib/server/workspace-suspension'

/**
 * Membership-safe suspension gate for every route mounted under a workspace.
 * It runs before child loaders, so a suspended workspace never starts an
 * ordinary page read on either SSR or client navigation.
 */
export const Route = createFileRoute('/workspaces/$workspaceSlug')({
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
    return { suspension }
  },
  component: Outlet
})
