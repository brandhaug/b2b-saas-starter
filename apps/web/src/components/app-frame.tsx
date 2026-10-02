import { type ReactNode, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  BellIcon,
  BookOpenIcon,
  HouseIcon,
  SettingsIcon,
  UserRoundIcon
} from 'lucide-react'
import { MobileNavSheet } from '@/components/mobile-nav-sheet'
import { WorkspaceNav } from '@/components/workspace-nav'
import { SearchButton } from '@/components/command-palette'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { AppRouteTabs } from '@/components/app-route-tabs'
import { buttonVariants } from '@/lib/button-variants'
import { cn } from '@/lib/utils'
import { previewWorkspaceLocation } from '@/lib/preview-navigation'
import { usePreview } from '@/lib/preview-context'
import { type Viewer } from '@/lib/permissions'
import { type SidebarWorkspace } from '@/lib/workspace-directory'
import { m } from '@b2b-saas-starter/i18n/messages'

/** Shared geometry for live and synthetic pages; callers retain their data and actions. */
export function AppFrame({
  children,
  workspace,
  viewer,
  systemRole,
  unreadCount,
  accountMenu,
  banner,
  context,
  support,
  layout = 'standard'
}: {
  readonly children: ReactNode
  readonly workspace: SidebarWorkspace | null
  readonly viewer: Viewer
  readonly systemRole?: string | null | undefined
  readonly unreadCount?: number | undefined
  readonly accountMenu?: ReactNode
  readonly banner?: ReactNode
  readonly context?: ReactNode
  readonly support?: ReactNode
  readonly layout?: 'standard' | 'wide' | undefined
}) {
  const preview = usePreview()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const notifications = preview
    ? {
        to: '/demo/$section' satisfies '/demo/$section',
        params: { section: 'notifications' }
      }
    : { to: '/account/notifications' satisfies '/account/notifications' }
  return (
    <div className="app-frame">
      <a href="#main-content" className="app-skip-link">
        {m.common_skip_to_content()}
      </a>
      <nav
        className="app-rail"
        aria-label={m.app_global_navigation()}
        data-account-menu={accountMenu === undefined ? undefined : true}
      >
        <Link to="/" className="app-brand" aria-label="B2B SaaS Starter">
          <img src="/assets/starter-logo.png" alt="" width={36} height={36} />
        </Link>
        <Separator />
        <div className="app-rail-actions">
          <Link
            to={preview ? '/demo' : '/workspaces'}
            className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
            aria-label={m.common_workspaces()}
            title={m.common_workspaces()}
          >
            <HouseIcon />
          </Link>
          <SearchButton compact />
          <Link
            {...notifications}
            className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
            aria-label={m.app_open_page({ page: m.notifications_title() })}
            title={m.notifications_title()}
          >
            <BellIcon />
          </Link>
          <Link
            to="/docs"
            className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
            aria-label={m.docs()}
            title={m.docs()}
          >
            <BookOpenIcon />
          </Link>
          {workspace === null ? null : (
            <Link
              {...(preview
                ? previewWorkspaceLocation('/workspaces/$workspaceSlug/settings')
                : {
                    to: '/workspaces/$workspaceSlug/settings',
                    params: { workspaceSlug: workspace.slug }
                  })}
              className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
              aria-label={m.app_open_page({ page: m.nav_settings() })}
              title={m.nav_settings()}
            >
              <SettingsIcon />
            </Link>
          )}
        </div>
        {preview ? (
          <Link
            to="/sign-in"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
              'mt-auto'
            )}
            aria-label={m.form_sign_in()}
            title={m.form_sign_in()}
          >
            <UserRoundIcon />
          </Link>
        ) : null}
      </nav>
      <aside className="app-sidebar">
        <WorkspaceNav workspace={workspace} viewer={viewer} systemRole={systemRole} />
      </aside>
      <div className="app-center">
        {banner}
        <header className="app-toolbar">
          <MobileNavSheet
            open={mobileNavOpen}
            onOpenChange={setMobileNavOpen}
            workspace={workspace}
            viewer={viewer}
            systemRole={systemRole}
          />
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {viewer === null ? m.common_workspaces() : workspace?.name}
          </div>
          <LanguageSwitcher />
          <div className="lg:hidden">
            <SearchButton />
          </div>
          {unreadCount === undefined ? null : (
            <Badge
              variant="neutral"
              className="gap-1 font-mono tabular-nums max-md:min-h-11 max-md:min-w-11"
              render={
                <Link
                  {...notifications}
                  aria-label={m.unread_notifications({ count: unreadCount })}
                />
              }
            >
              <BellIcon />
              {unreadCount}
            </Badge>
          )}
          <div className="app-account-menu">{accountMenu}</div>
        </header>
        <AppRouteTabs workspace={workspace} viewer={viewer} systemRole={systemRole} />
        <main id="main-content" tabIndex={-1} className="app-main">
          <div
            className={cn(
              'mx-auto grid w-full gap-8',
              layout === 'wide' ? 'max-w-7xl' : 'max-w-4xl'
            )}
          >
            {children}
          </div>
        </main>
      </div>
      <aside className="app-context" aria-label={m.app_context()}>
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">{m.app_context()}</h2>
            <p className="text-sm text-muted-foreground">
              {preview ? m.demo_preview_notice() : m.app_context_description()}
            </p>
            {preview ? (
              <Link to="/sign-in" className={buttonVariants({ variant: 'outline' })}>
                {m.demo_try_sign_in()}
              </Link>
            ) : null}
          </section>
          {context}
          <Separator />
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">{m.app_resources()}</h2>
            <Link to="/docs" className="app-resource-link">
              <BookOpenIcon className="size-4" />
              {m.app_read_documentation()}
            </Link>
            <Link to="/help" reloadDocument className="app-resource-link">
              {m.public_meta_support()}
            </Link>
            {support}
          </section>
        </div>
      </aside>
      <footer className="app-bottom-bar">
        <span className="truncate">B2B SaaS Starter</span>
        <span className="ml-auto truncate">
          {preview ? m.app_sample_data() : m.app_reference_application()}
        </span>
        <Link to="/help" reloadDocument>
          {m.public_meta_support()}
        </Link>
      </footer>
    </div>
  )
}
