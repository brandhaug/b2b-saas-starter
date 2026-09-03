import { type WorkspaceViewer } from '@/lib/permissions'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { whenPermitted } from './authorize'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'
import {
  workspaceExportsSegment,
  type WorkspaceExportsSegment
} from './workspace-exports'

/**
 * The workspace settings payload, assembled per actor.
 *
 * Settings is the workspace's own identity surface: rename and delete. The
 * membership surface (roster, invitations) lives on the members page and the
 * developer surfaces (tokens, webhooks) own their pages — this payload once
 * carried pointer segments for all of them, which duplicated every other
 * page's data on a page that renders none of it.
 *
 * `viewer` carries the actor's workspace role to the client, where the same
 * pure `authorize()` decides whether a control renders. The server enforcing
 * the mutation permissions is the boundary; the client check is what stops a
 * member being shown a form that would only fail on submit.
 */
export type WorkspaceSettingsPayload = {
  readonly viewer: WorkspaceViewer | null
  /** The workspace itself; every member may read its own name. */
  readonly workspaceName: string
  readonly unreadCount: number
  /**
   * Workspace data export (ADR 0055): owner-only, so `null` for every other
   * role — the card is absent, not disabled. Present, it carries whether this
   * deployment can produce exports at all, so the page explains an
   * unconfigured bucket instead of offering a button that fails.
   */
  readonly exports: WorkspaceExportsSegment | null
}

/**
 * `notification:read` is the page's own read permission and a hard gate: an
 * actor who cannot read notifications has no settings page to render, so that
 * is a 403 rather than an empty shell.
 */
const settingsPayload: WorkspacePageFrame<WorkspaceSettingsPayload> = workspacePage(
  { notification: ['read'] },
  (ctx) =>
    Effect.map(
      Effect.all(
        {
          unreadCount,
          exports: whenPermitted(
            { workspaceExport: ['request'] },
            workspaceExportsSegment
          )
        },
        { concurrency: 'unbounded' }
      ),
      (segments) => ({ workspaceName: ctx.workspace.name, ...segments })
    )
)

/** The settings route's loader. */
export function loadWorkspaceSettings(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceSettingsPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, settingsPayload, {
    userId: input.userId
  })
}
