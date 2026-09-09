import { type WorkspaceOverviewProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { createServerFn } from '@tanstack/react-start'

/**
 * Client-safe homepage summary. The handler's dynamic import keeps capability
 * implementations and Effect Schema out of the route tree's browser graph.
 */

export type DemoShowcase = {
  /** The exact JSON the REST `overview` endpoint returns for the workspace. */
  readonly overview: WorkspaceOverviewProjection
  /** Live counts off the seed workspace's members and broadcast feed. */
  readonly memberCount: number
  readonly notificationCount: number
  /** The vocabulary the starter enforces: RBAC's role tuple, the audit taxonomy. */
  readonly roleCount: number
  readonly auditEventTypeCount: number
}

/**
 * The `/` landing numbers. `null` when the showcase workspace does not exist
 * in the backing store: the landing page must never 404 over its demo strip,
 * so a missing workspace degrades to "no numbers" rather than an error.
 */
export const loadDemoShowcaseServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DemoShowcase | null> => {
    const { loadDemoShowcase } = await import('./demo-showcase.effects')
    return loadDemoShowcase()
  }
)
