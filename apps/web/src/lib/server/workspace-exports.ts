import {
  type WorkspaceExport,
  type WorkspaceExportAvailability
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * Workspace data export (ADR 0055) on the session surface, in a
 * **client-safe** module — the `invitations.ts` pattern: the settings page's
 * export segment and the "Request export" mutation. Both name the owner-only
 * `workspaceExport` statements — the loader withholds the segment from every
 * other role, and the server function re-checks the permission before the
 * capability call, like every other workspace mutation.
 *
 * The client-safe half of the `workspace-exports.effects.ts` split (see
 * apps/web/AGENTS.md for the rule and `assert-client-boundary.mjs` for the
 * enforcement). Each input is written once, as its Effect Schema: the
 * validator is the single strict decode, and the derived type types both
 * the client stub and the effects handler.
 */

export type WorkspaceExportsSegment = {
  readonly availability: WorkspaceExportAvailability
  readonly exports: ReadonlyArray<WorkspaceExport>
}

const RequestExportInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type RequestExportInput = typeof RequestExportInput.Type

export const requestWorkspaceExportServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(RequestExportInput))
  .handler(async ({ data }): Promise<WorkspaceExport> => {
    const { requestWorkspaceExportHandler } =
      await import('./workspace-exports.effects')
    return requestWorkspaceExportHandler(data)
  })

const DownloadExportInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  exportId: Schema.NonEmptyString
})
export type DownloadExportInput = typeof DownloadExportInput.Type

export const downloadWorkspaceExportServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(DownloadExportInput))
  .handler(async ({ data }): Promise<string | null> => {
    const { downloadWorkspaceExportHandler } =
      await import('./workspace-exports.effects')
    return downloadWorkspaceExportHandler(data)
  })
