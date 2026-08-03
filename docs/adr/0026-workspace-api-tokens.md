# Workspace API tokens

Superseded by [ADR 0053](./0053-read-and-notify-merchant-platform-api.md) for the Booking Product.

The starter includes workspace-scoped API tokens for REST and MCP access. Tokens should be stored hashed, support simple scopes such as read, write, and admin, track last use, expose create and revoke UI, and emit audit events for lifecycle changes and sensitive usage.
