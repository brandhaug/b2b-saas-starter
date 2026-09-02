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
 * The workspace nav as one table: target, label, and — for sections whose
 * read is itself a permission — the permission a viewer must hold. The sidebar
 * filters with `viewerCan`, the same pure `authorize()` the server guard
 * uses, so a row the viewer cannot read is absent rather than dead. Keeping
 * the permission on the row (instead of per-page booleans) is what keeps the
 * nav identical on every workspace page — and it lets the command palette
 * generate its workspace entries from the same table instead of a second
 * hand-kept list.
 */
export const WORKSPACE_NAV: ReadonlyArray<{
  readonly to: WorkspaceNavTarget
  readonly label: string
  readonly icon: ReactNode
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
    label: 'Settings',
    icon: <SettingsIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/billing',
    label: 'Billing',
    icon: <CreditCardIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/api-tokens',
    label: 'API tokens',
    icon: <KeyRoundIcon className="size-4" />,
    permission: { apiToken: ['list'] }
  },
  {
    to: '/workspaces/$workspaceSlug/webhooks',
    label: 'Webhooks',
    icon: <WebhookIcon className="size-4" />,
    permission: { webhook: ['list'] }
  },
  {
    to: '/workspaces/$workspaceSlug/audit',
    label: 'Audit trail',
    icon: <HistoryIcon className="size-4" />,
    permission: { auditLog: ['read'] }
  }
]
