import {
  type WorkspaceExport,
  type WorkspaceExportAvailability
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'

/**
 * Workspace data export (ADR 0055) on the session surface, in a
 * **client-safe** module — the `invitations.ts` pattern: the settings page's
 * export segment and the "Request export" mutation. Both name the owner-only
 * `workspaceExport` statements — the loader withholds the segment from every
 * other role, and the server function re-checks the permission before the
 * capability call, like every other workspace mutation.
 *
 * This file is statically imported by the settings route's payload and the
 * export panel, and the route tree ships to the browser — so everything at
 * this module's top level rides on every page. That is why the segment
 * assembly and the request effect (the capability service, the env reader,
 * the permission gate) live in `workspace-exports.effects.ts` and are
 * reached only through dynamic `import()` inside the handler: TanStack Start
 * strips handler bodies from the client build, so the effects graph never
 * ships. The validator is stripped the same way — `.validator()` runs on the
 * server only — so the plain shape check below is the server's first decode,
 * while the strict schema decodes again in the effects file.
 */

/** One export as the settings page renders it: the record plus a signed link when it is downloadable. */
export type WorkspaceExportView = WorkspaceExport & {
  readonly downloadUrl: string | null
}

export type WorkspaceExportsSegment = {
  readonly availability: WorkspaceExportAvailability
  readonly exports: ReadonlyArray<WorkspaceExportView>
}

type RequestExportInput = {
  readonly workspaceSlug: string
}

/**
 * The server fn's validator, a plain shape check that runs on the server only
 * (TanStack strips `.validator()` from the client build): it is the server's
 * first decode, and the strict schema decodes again in
 * `workspace-exports.effects.ts`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeRequestInput(input: unknown): RequestExportInput {
  const record = expectRecord(input, 'export request input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'export request input')
  }
}

export const requestWorkspaceExportServerFn = createServerFn({ method: 'POST' })
  .validator(decodeRequestInput)
  .handler(async ({ data }): Promise<WorkspaceExport> => {
    const { requestWorkspaceExportHandler } =
      await import('./workspace-exports.effects')
    return requestWorkspaceExportHandler(data)
  })
