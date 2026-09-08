# Keyset pagination for list endpoints

REST and MCP list operations share cursor and limit inputs and return items plus a continuation cursor. Keyset positions use the collection's canonical sort key and ID tie-breaker, preventing inserted rows from shifting an offset-based page boundary.

The shared cursor helpers own encoding, limit clamping, and page construction; Live SQL and Seed ordering must agree. Clients treat cursors as opaque. Malformed cursors return an empty page. Public contracts and collection implementations own current limits and ordering, avoiding another endpoint inventory here.
