import {
  WORKSPACE_ROLES,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/** The roles a member can be moved to from their current one. */
function otherRoles(current: WorkspaceRole): ReadonlyArray<WorkspaceRole> {
  return WORKSPACE_ROLES.filter((role) => role !== current)
}

/**
 * One button per role the subject does not already hold. Used by the workspace
 * roster and by `/admin`'s cross-workspace editor, which name the buttons
 * differently because their subjects differ — a member in this workspace
 * versus this user's membership in some workspace — hence `labelFor`.
 *
 * Presentation only: whether these render at all is the caller's
 * `viewerCan(...)` decision, and the server re-checks every change.
 */
export function RoleChangeButtons({
  currentRole,
  labelFor,
  disabled,
  busy = false,
  onChange
}: {
  readonly currentRole: WorkspaceRole
  /** The button's accessible name for a given target role. */
  readonly labelFor: (role: WorkspaceRole) => string
  readonly disabled: boolean
  /** Marks the buttons as the change in flight, with a spinner. */
  readonly busy?: boolean
  readonly onChange: (role: WorkspaceRole) => void
}) {
  return otherRoles(currentRole).map((role) => (
    <Button
      key={role}
      variant="ghost"
      size="sm"
      disabled={disabled}
      aria-label={labelFor(role)}
      onClick={() => onChange(role)}
    >
      {busy ? <Spinner data-icon="inline-start" /> : null}
      Make {role}
    </Button>
  ))
}
