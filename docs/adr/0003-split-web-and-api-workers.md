# Split web and API workers

The web worker owns TanStack Start pages, server functions, and Better Auth routes. A separate API worker serves REST and streamable-HTTP MCP so external clients have an independent entry point. Both call shared capabilities; MCP discovery and tool dispatch derive from the [operation catalog](./0072-workspace-operation-catalog.md).
