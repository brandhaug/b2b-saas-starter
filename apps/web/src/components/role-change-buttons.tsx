import {
  WORKSPACE_ROLES,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/** The offered roles a subject can be moved to from their current one. */
function offeredRolesExcept(
  offerRoles: ReadonlyArray<WorkspaceRole>,
  current: WorkspaceRole
): ReadonlyArray<WorkspaceRole> {
  return offerRoles.filter((role) => role !== current)
}

/**
 * One button per offered role the subject does not already hold. Used by the
 * workspace roster and by `/admin`'s cross-workspace editor, which name the
 * buttons differently because their subjects differ — a member in this
 * workspace versus this user's membership in some workspace — hence
 * `labelFor`.
 *
 * `offerRoles` narrows the buttons to roles the caller's surface can honestly
 * offer (the roster hides "Make owner" from a non-owner actor, mirroring the
 * plugin's rule that only owners grant the owner role); the default offers
 * every role.
 *
 * Presentation only: whether these render at all is the caller's
 * `viewerCan(...)` decision, and the server re-checks every change.
 */
export function RoleChangeButtons({
  currentRole,
  offerRoles = WORKSPACE_ROLES,
  labelFor,
  disabled,
  busy = false,
  onChange
}: {
  readonly currentRole: WorkspaceRole
  /** The roles this surface offers; the subject's current one is still excluded. */
  readonly offerRoles?: ReadonlyArray<WorkspaceRole>
  /** The button's accessible name for a given target role. */
  readonly labelFor: (role: WorkspaceRole) => string
  readonly disabled: boolean
  /** Marks the buttons as the change in flight, with a spinner. */
  readonly busy?: boolean
  readonly onChange: (role: WorkspaceRole) => void
}) {
  return offeredRolesExcept(offerRoles, currentRole).map((role) => (
    <Button
      key={role}
      variant="ghost"
      disabled={disabled}
      aria-label={labelFor(role)}
      onClick={() => onChange(role)}
    >
      {busy ? <Spinner data-icon="inline-start" /> : null}
      Make {role}
    </Button>
  ))
}
