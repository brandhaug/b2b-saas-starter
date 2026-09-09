import { type WorkspaceNavTarget } from '@/lib/workspace-nav'

export function previewWorkspaceLocation(
  to: WorkspaceNavTarget
):
  | { readonly to: '/demo' }
  | { readonly to: '/demo/$section'; readonly params: { readonly section: string } } {
  return to === '/workspaces/$workspaceSlug'
    ? { to: '/demo' }
    : {
        to: '/demo/$section',
        params: { section: to.slice('/workspaces/$workspaceSlug/'.length) }
      }
}
