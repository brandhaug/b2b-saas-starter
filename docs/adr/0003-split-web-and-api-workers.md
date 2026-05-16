# Split web and API workers

The starter uses both a TanStack Start web worker and a separate Cloudflare API worker. The web worker owns pages, server functions, and Better Auth routes, while the API worker owns the public REST API and MCP server; both depend on shared capability, auth, database, and Effect HTTP contract packages so behavior is not duplicated.
