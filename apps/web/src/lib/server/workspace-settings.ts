import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'
import { type WorkspaceExportsSegment } from './workspace-exports'

/**
 * The workspace settings loader, in a **client-safe** module.
 *
 * This file is statically imported by the settings route, and the route tree
 * ships to the browser — so everything at this module's top level rides on
 * every page. That is why the payload assembly and its imports (the
 * capability services, the permission helpers, the export segment) live in
 * `workspace-settings.effects.ts` and are reached only through dynamic
 * `import()` inside the handler: TanStack Start strips handler bodies from
 * the client build, so the capabilities graph never ships, while the payload
 * type still does.
 *
 * The behaviour is tested as the plain loader function in the effects file
 * (`workspace-settings.test.ts`), driven directly with fixture actors.
 */

/**
 * The workspace settings payload, assembled per actor.
 *
 * Settings is the workspace's own identity surface: rename and delete. The
 * membership surface (roster, invitations) lives on the members page and the
 * developer surfaces (tokens, webhooks) own their pages — this payload once
 * carried pointer segments for all of them, which duplicated every other
 * page's data on a page that renders none of it.
 *
 * The exception is Single sign-on (ADR 0069): the connection list is security
 * posture (`sso:list`, withheld from members), and the settings page hosts the
 * management surface — so its segment rides here, soft-gated like every
 * second-permission segment. The DTO the capability returns is secret-free.
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
  /** `null` for an actor without `sso:list`: the read never ran. */
  readonly ssoConnections: ReadonlyArray<SsoConnection> | null
  /**
   * Workspace data export (ADR 0055): owner-only, so `null` for every other
   * role — the card is absent, not disabled. Present, it carries whether this
   * deployment can produce exports at all, so the page explains an
   * unconfigured bucket instead of offering a button that fails.
   */
  readonly exports: WorkspaceExportsSegment | null
}

type WorkspaceSettingsInput = {
  readonly workspaceSlug: string
}

/**
 * The server fn's validator, a plain shape check that runs on the server only
 * (TanStack strips `.validator()` from the client build): it is the server's
 * first decode, and the strict schema decodes again in
 * `workspace-settings.effects.ts`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeSettingsInput(input: unknown): WorkspaceSettingsInput {
  const record = expectRecord(input, 'settings input')
  return { workspaceSlug: expectString(record, 'workspaceSlug', 'settings input') }
}

/**
 * The settings route's loader. `notification:read` is the page's own read
 * permission and a hard gate: an actor who cannot read notifications has no
 * settings page to render, so that is a 403 rather than an empty shell.
 */
export const loadWorkspaceSettingsServerFn = createServerFn({ method: 'GET' })
  .validator(decodeSettingsInput)
  .handler(async ({ data }): Promise<WorkspaceSettingsPayload> => {
    const { loadWorkspaceSettingsHandler } =
      await import('./workspace-settings.effects')
    return loadWorkspaceSettingsHandler(data)
  })
