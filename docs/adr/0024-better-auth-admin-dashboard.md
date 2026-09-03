# Better Auth admin dashboard

The starter includes Better Auth's admin plugin and a basic global admin dashboard for user management. This system admin surface is separate from workspace roles: workspace owners and admins manage workspace-scoped settings and membership, while Better Auth admin users can perform global user operations such as listing users, changing roles, banning or unbanning users, and inspecting sessions where supported. Impersonation may be available through the plugin but should not be exposed in the first dashboard UI until audit logging, visible impersonation state, and session safety controls are designed.

Amended (issue #98): ban/unban and cross-workspace role changes now ship in `/admin` through the `PlatformUserAdmin` capability, audited as `system_admin.*` events.

Amended: impersonation now ships too, the three preconditions above having been met — see [ADR 0054](./0054-system-admin-impersonation.md).
