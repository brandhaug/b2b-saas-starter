import { Link, useRouterState } from '@tanstack/react-router'
import { workspaceNav } from '@/lib/workspace-nav'
import { viewerCan, adminSystemRole, type Viewer } from '@/lib/permissions'
import { previewWorkspaceLocation } from '@/lib/preview-navigation'
import { usePreview } from '@/lib/preview-context'
import { type SidebarWorkspace } from '@/lib/workspace-directory'
import { m } from '@b2b-saas-starter/i18n/messages'

/** Links switch routes; each page's SectionTabs still owns its local tab state. */
export function AppRouteTabs({
  workspace,
  viewer,
  systemRole
}: {
  readonly workspace: SidebarWorkspace | null
  readonly viewer: Viewer
  readonly systemRole?: string | null | undefined
}) {
  const preview = usePreview()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const rows = workspaceNav().filter(
    (row) => row.permission === undefined || viewerCan(viewer, row.permission)
  )
  const current = rows.find((row) => {
    const path = preview
      ? row.to.replace('/workspaces/$workspaceSlug', '/demo')
      : row.to.replace('$workspaceSlug', workspace?.slug ?? '')
    return pathname.replace(/\/$/u, '') === path
  })
  return (
    <nav className="app-route-tabs" aria-label={m.app_related_pages()}>
      {workspace !== null && current !== undefined ? (
        rows.map((row) =>
          row.group === current.group ? (
            <Link
              key={row.to}
              {...(preview
                ? previewWorkspaceLocation(row.to)
                : { to: row.to, params: { workspaceSlug: workspace.slug } })}
              className="app-route-tab"
              activeOptions={{ exact: true }}
              activeProps={{ 'aria-current': 'page' }}
              aria-label={m.app_open_page({ page: row.label })}
            >
              {row.icon}
              {row.label}
            </Link>
          ) : null
        )
      ) : (
        <>
          <Link
            to={preview ? '/demo' : '/workspaces'}
            className="app-route-tab"
            activeOptions={{ exact: true }}
            activeProps={{ 'aria-current': 'page' }}
            aria-label={m.app_open_page({ page: m.common_workspaces() })}
          >
            {m.common_workspaces()}
          </Link>
          <Link
            to={preview ? '/sign-in' : '/account'}
            className="app-route-tab"
            activeOptions={{ exact: true }}
            activeProps={{ 'aria-current': 'page' }}
            aria-label={m.app_open_page({ page: m.nav_account() })}
          >
            {m.nav_account()}
          </Link>
          <Link
            {...(preview
              ? {
                  to: '/demo/$section' satisfies '/demo/$section',
                  params: { section: 'notifications' }
                }
              : { to: '/account/notifications' satisfies '/account/notifications' })}
            className="app-route-tab"
            activeProps={{ 'aria-current': 'page' }}
            aria-label={m.app_open_page({ page: m.notifications_title() })}
          >
            {m.notifications_title()}
          </Link>
          {!preview && systemRole === adminSystemRole ? (
            <Link
              to="/admin"
              className="app-route-tab"
              activeProps={{ 'aria-current': 'page' }}
              aria-label={m.app_open_page({ page: m.nav_system_admin() })}
            >
              {m.nav_system_admin()}
            </Link>
          ) : null}
        </>
      )}
    </nav>
  )
}
