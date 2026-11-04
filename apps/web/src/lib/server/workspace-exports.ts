import {
  type WorkspaceExport,
  type WorkspaceExportAvailability
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The settings loader withholds exports without `workspaceExport` permission.
 * Mutations re-check that permission before calling the capability (ADR 0055).
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
