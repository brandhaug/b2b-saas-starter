import { type WorkspaceOverviewProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { createServerFn } from '@tanstack/react-start'

import { type WorkspaceDashboardPayload } from './workspace-dashboard'

/**
 * The public showcase reads, in a **client-safe** module.
 *
 * `routes/index.tsx` and `routes/demo.tsx` statically import this file, and
 * the route tree ships to the browser — so everything at this module's top
 * level rides on every page. That is why the capability effects and their
 * imports live in `demo-showcase.effects.ts` and are reached only through
 * dynamic `import()` inside each handler: TanStack Start strips handler
 * bodies from the client build, so the capabilities graph (and the Effect
 * Schema chunks it drags) never ships, while the payload types still do.
 *
 * The behaviour itself is testable as the plain module functions in the
 * effects file, like the invitation effects are.
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

/**
 * The `/demo` payload: the dashboard page rendered for the demo persona. A
 * missing showcase workspace still 404s through the shared failure mapping —
 * the serialized `notFound()` duck-types across the server-fn boundary.
 */
export const loadDemoWorkspaceServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WorkspaceDashboardPayload> => {
    const { loadDemoWorkspace } = await import('./demo-showcase.effects')
    return loadDemoWorkspace()
  }
)
