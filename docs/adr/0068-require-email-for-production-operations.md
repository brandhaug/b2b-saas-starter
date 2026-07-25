# Require email delivery for production Operations

The production Operations App fails closed when transactional email is unavailable because operator verification, invitations, security notices, and target impersonation notifications are part of its access and transparency controls. Local development uses a deterministic capture adapter so contributors remain provider-light. This deliberately differs from optional product email delivery, which may degrade without blocking ordinary booking operations.
