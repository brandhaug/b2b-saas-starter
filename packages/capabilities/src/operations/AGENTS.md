# Operations

Platform-wide staff workflows for the Operations App. This bounded context owns
operator-facing contracts, discovery, invitations and management, impersonation
policy and lifecycle, Operations audit review, lifecycle notifications, abuse
protection, and System Operator maintenance.

Operations may use reusable governance mechanisms, but governance must not own or
re-export Operations workflows. App routes, auth adapters, background delivery,
and scripts consume the public `@b2b-saas-starter/capabilities/operations` seam.
