import { type ReactNode } from 'react'
import {
  CreditCardIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  UserRoundIcon,
  UsersIcon,
  WebhookIcon
} from 'lucide-react'
import { type PermissionRequest } from '@b2b-saas-starter/authz/client'

export type WorkspaceNavTarget =
  | '/workspaces/$workspaceSlug'
  | '/workspaces/$workspaceSlug/assistant'
  | '/workspaces/$workspaceSlug/api-tokens'
  | '/workspaces/$workspaceSlug/billing'
  | '/workspaces/$workspaceSlug/members'
  | '/workspaces/$workspaceSlug/settings'
  | '/workspaces/$workspaceSlug/audit'
  | '/workspaces/$workspaceSlug/webhooks'

/** Nav targets outside any workspace: the user-level rows. */
export type YouNavTarget = '/account' | '/admin'

/**
 * The section a row renders under. Rows sharing a group render beneath one
 * label, in table order: workspace content first, then the developer
 * platform, then the user-level rows — which is why Account and System admin
 * can never inherit the previous group's label. The type keeps `group`
 * optional because the command palette defends on `row.group === undefined`;
 * every row below declares one.
 */
export type WorkspaceNavGroup = 'Workspace' | 'Developer' | 'You'

/** Fields shared by every nav row, whichever surface it targets. */
type NavRow = {
  readonly label: string
  readonly group?: WorkspaceNavGroup
  readonly icon: ReactNode
  /** For rows whose read is itself a permission: the viewer must hold it. */
  readonly permission?: PermissionRequest
  /** Match the link exactly, or every subpage would also mark it current. */
  readonly exact?: boolean
  /**
   * Renders only for a system admin: /admin 404s for every other role (the
   * route keeps its own `requireAdmin` gate — this is presentation, not
   * enforcement).
   */
  readonly adminOnly?: boolean
}

export type WorkspaceNavRow = NavRow & { readonly to: WorkspaceNavTarget }

export type YouNavRow = NavRow & {
  readonly to: YouNavTarget
}

export type ShellNavRow = WorkspaceNavRow | YouNavRow

/** Narrows a row target to the workspace-scoped rows, which take the slug param. */
export function isWorkspaceNavTarget(to: ShellNavRow['to']): to is WorkspaceNavTarget {
  return to.startsWith('/workspaces/')
}

/**
 * The workspace-scoped nav rows: target, label, section, and — for sections
 * whose read is itself a permission — the permission a viewer must hold. The
 * sidebar filters with `viewerCan`, the same pure `authorize()` the server
 * guard uses, so a row the viewer cannot read is absent rather than dead.
 * Keeping the permission on the row (instead of per-page booleans) is what
 * keeps the nav identical on every workspace page — and it lets the command
 * palette generate its workspace entries from this same table instead of a
 * second hand-kept list.
 */
export const WORKSPACE_NAV: ReadonlyArray<WorkspaceNavRow> = [
  {
    to: '/workspaces/$workspaceSlug',
    label: 'Overview',
    group: 'Workspace',
    icon: <LayoutDashboardIcon className="size-4" />,
    exact: true
  },
  {
    // Members owns the roster and, since the settings page stopped carrying
    // it, the invitation flow too — both are membership concerns.
    to: '/workspaces/$workspaceSlug/members',
    label: 'Members',
    group: 'Workspace',
    icon: <UsersIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/assistant',
    label: 'Assistant',
    group: 'Workspace',
    icon: <SparklesIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/settings',
    label: 'General',
    group: 'Workspace',
    icon: <SettingsIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/billing',
    label: 'Billing',
    group: 'Workspace',
    icon: <CreditCardIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/audit',
    label: 'Audit trail',
    group: 'Workspace',
    icon: <HistoryIcon className="size-4" />,
    permission: { auditLog: ['read'] }
  },
  {
    to: '/workspaces/$workspaceSlug/api-tokens',
    label: 'API tokens',
    group: 'Developer',
    icon: <KeyRoundIcon className="size-4" />,
    permission: { apiToken: ['list'] }
  },
  {
    to: '/workspaces/$workspaceSlug/webhooks',
    label: 'Webhook endpoints',
    group: 'Developer',
    icon: <WebhookIcon className="size-4" />,
    permission: { webhook: ['list'] }
  }
]

/**
 * The user-level rows that close the sidebar under their own "You" label.
 * They live in the same table as the workspace rows (`SHELL_NAV` below) so
 * the sidebar renders every row — grouping included — from data, never from
 * links appended after the group loop. Exported because the command palette
 * generates its Account and System admin entries from the same rows, so the
 * two surfaces cannot drift on label, target, or the admin gate.
 */
export const YOU_NAV: ReadonlyArray<YouNavRow> = [
  {
    to: '/account',
    label: 'Account',
    group: 'You',
    icon: <UserRoundIcon className="size-4" />,
    exact: true
  },
  {
    to: '/admin',
    label: 'System admin',
    group: 'You',
    icon: <ShieldIcon className="size-4" />,
    exact: true,
    adminOnly: true
  }
]

/**
 * The sidebar's one nav table: the workspace rows in table order, closed by
 * the user-level rows. The command palette generates its workspace entries
 * from `WORKSPACE_NAV` and its user-level entries from `YOU_NAV`, so both
 * surfaces read the same tables.
 */
export const SHELL_NAV: ReadonlyArray<ShellNavRow> = [...WORKSPACE_NAV, ...YOU_NAV]
