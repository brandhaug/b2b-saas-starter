# Shared capabilities package

The starter includes `packages/capabilities` as the application layer for workspace, notification, audit, API token, and webhook use cases. Web server functions, the API worker, MCP tools, background workers, and tests should call these Effect services instead of duplicating business behavior in route handlers or UI components.
