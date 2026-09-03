import { type ReactNode } from 'react'
import {
  CreditCardIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  SparklesIcon,
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

/**
 * The section a row renders under, or `undefined` for the top of the nav.
 * Rows sharing a group render beneath one label, in table order.
 */
export type WorkspaceNavGroup = 'Settings'

/**
 * The workspace nav as one table: target, label, section, and — for sections
 * whose read is itself a permission — the permission a viewer must hold. The
 * sidebar filters with `viewerCan`, the same pure `authorize()` the server
 * guard uses, so a row the viewer cannot read is absent rather than dead.
 * Keeping the permission on the row (instead of per-page booleans) is what
 * keeps the nav identical on every workspace page — and it lets the command
 * palette generate its workspace entries from the same table instead of a
 * second hand-kept list.
 */
export const WORKSPACE_NAV: ReadonlyArray<{
  readonly to: WorkspaceNavTarget
  readonly label: string
  readonly icon: ReactNode
  readonly group?: WorkspaceNavGroup
  readonly permission?: PermissionRequest
  /** The overview link must match exactly, or every subpage would also mark it current. */
  readonly exact?: boolean
}> = [
  {
    to: '/workspaces/$workspaceSlug',
    label: 'Overview',
    icon: <LayoutDashboardIcon className="size-4" />,
    exact: true
  },
  {
    // Members owns the roster and, since the settings page stopped carrying
    // it, the invitation flow too — both are membership concerns.
    to: '/workspaces/$workspaceSlug/members',
    label: 'Members',
    icon: <UsersIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/assistant',
    label: 'Assistant',
    icon: <SparklesIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/settings',
    label: 'General',
    group: 'Settings',
    icon: <SettingsIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/billing',
    label: 'Billing',
    group: 'Settings',
    icon: <CreditCardIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/api-tokens',
    label: 'API tokens',
    group: 'Settings',
    icon: <KeyRoundIcon className="size-4" />,
    permission: { apiToken: ['list'] }
  },
  {
    to: '/workspaces/$workspaceSlug/webhooks',
    label: 'Webhook endpoints',
    group: 'Settings',
    icon: <WebhookIcon className="size-4" />,
    permission: { webhook: ['list'] }
  },
  {
    to: '/workspaces/$workspaceSlug/audit',
    label: 'Audit trail',
    group: 'Settings',
    icon: <HistoryIcon className="size-4" />,
    permission: { auditLog: ['read'] }
  }
]
