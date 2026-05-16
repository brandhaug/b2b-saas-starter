# No Durable Objects without a coordination need

The starter does not include Durable Objects in the initial implementation because its workspace, starter module, readiness, API, MCP, and background refresh flows do not require single-instance coordination or realtime authoritative state. Durable Objects should be documented as an extension point for realtime collaboration, job coordination, or per-tenant state, but not copied from Hexwardens without a concrete use case.
