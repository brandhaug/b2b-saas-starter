import { type WorkspaceListItemProjection } from '@b2b-saas-starter/capabilities/workspace-projections'

/** The signed-in user's workspace directory returned by the page loader. */
export type WorkspaceDirectory = ReadonlyArray<WorkspaceListItemProjection>
