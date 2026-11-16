import { type WorkspaceId } from '@b2b-saas-starter/db/ids'
import { workspaceExports } from '@b2b-saas-starter/db/schema/governance'
import { and, eq } from 'drizzle-orm'
import { initialWorkspaceExportStatus } from './workspace-export.ts'

/** The R2 key: one prefix per workspace, so a bucket listing groups by owner. */
export function objectKeyFor(workspaceId: WorkspaceId, exportId: string): string {
  return `workspaces/${workspaceId}/${exportId}.json.gz`
}

/** The pending row a queue message names, scoped to its workspace. */
export function pendingWhere(exportId: string, workspaceId: WorkspaceId) {
  return and(
    eq(workspaceExports.id, exportId),
    eq(workspaceExports.workspaceId, workspaceId),
    eq(workspaceExports.status, initialWorkspaceExportStatus)
  )
}
