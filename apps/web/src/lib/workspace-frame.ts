import { type Viewer } from '@/lib/permissions'

/**
 * What `WorkspaceShell` renders around a page: the viewer whose role
 * `viewerCan` re-decides on the client for the nav, and the unread count the
 * header badges. The shell takes it as one required `frame` prop. Surfaces
 * outside a workspace pass `noWorkspaceFrame`; the suspended-workspace page
 * passes its viewer with `unreadCount: null`. Client-safe.
 */
export type WorkspaceFrame = {
  readonly viewer: Viewer
  /** `null` hides the badge. */
  readonly unreadCount: number | null
}

/** No viewer, no badge: account, admin and error surfaces. */
export const noWorkspaceFrame: WorkspaceFrame = { viewer: null, unreadCount: null }

/**
 * A workspace page's payload: its own segment plus the frame `workspacePage`
 * (`./server/page-frame.ts`) attaches, which always carries the count.
 */
export type WorkspacePagePayload<Segment> = Segment &
  WorkspaceFrame & { readonly unreadCount: number }
