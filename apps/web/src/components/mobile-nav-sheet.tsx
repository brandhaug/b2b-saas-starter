import { MenuIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'
import { SearchButton } from '@/components/command-palette'
import { LanguageSwitcher } from '@/components/language-switcher'
import { WorkspaceNav } from '@/components/workspace-nav'
import { type Viewer } from '@/lib/permissions'
import { type SidebarWorkspace } from '@/lib/workspace-directory'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The narrow-viewport half of the workspace sidebar: the same nav the wide
 * layout renders inline, behind a trigger, plus the search and language
 * controls the wide header carries on its own. Shared by the signed-in shell
 * and the `/demo` preview shell, which differ only in the nav's inputs.
 */
export function MobileNavSheet({
  open,
  onOpenChange,
  workspace,
  viewer,
  systemRole
}: {
  readonly open: boolean
  readonly onOpenChange: (next: boolean) => void
  readonly workspace: SidebarWorkspace | null
  readonly viewer: Viewer
  readonly systemRole?: string | null | undefined
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="lg:hidden">
            <MenuIcon className="size-5" />
            <span className="sr-only">{m.common_open_navigation()}</span>
          </Button>
        }
      />
      <SheetContent
        side="left"
        className="flex min-h-0 flex-col gap-0 overflow-hidden bg-sidebar text-sidebar-foreground border-sidebar-border"
      >
        <SheetHeader>
          <SheetTitle className="sr-only">{m.common_workspace_navigation()}</SheetTitle>
          <SheetDescription className="sr-only">
            {m.switch_workspace_sections()}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <WorkspaceNav
            workspace={workspace}
            viewer={viewer}
            systemRole={systemRole}
            onNavigate={() => onOpenChange(false)}
          />
          <div className="mt-6 grid gap-4 border-t border-sidebar-border pt-4">
            <SearchButton />
            <LanguageSwitcher />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
